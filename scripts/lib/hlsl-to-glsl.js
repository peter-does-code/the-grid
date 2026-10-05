'use strict';

/*
 * En anden oversætter af MilkDrops pixel-shadere (HLSL) til Butterchurns GLSL, til de presets, hvor
 * milkdrop-preset-converter (hlslparser-js) ødelægger regnestykkerne (05-10-2026: den skriver `&&` i stedet for
 * plus, minus og gange, når tal og vektorer blandes, så billedet bliver hvidt eller sort; se shader-overrides.js).
 *
 * MilkDrops shadere er korte og bruger en lille del af HLSL, så oversættelsen er overvejende ord for ord:
 *  - typer: float1-4 → float/vec2-4, floatNxN → matN, half → float;
 *  - funktioner: tex2D/tex3D → texture, frac → fract, lerp → mix, saturate → clamp, atan2 → atan, fmod → mod,
 *    rsqrt → inversesqrt, og MilkDrops makroer GetBlur1-3, GetMain, GetPixel, lum;
 *  - hele tal i regnestykker → kommatal (GLSL ganger ikke vec2 med 4, kun med 4.0);
 *  - HLSL blander tal og vektorer frit (lerp(0, float3(...), t), max(0, v)). Her bruges hjælpefunktioner med alle
 *    kombinationer (_gl_mix, _gl_max, ...), og hver tildeling pakkes ind i målets type (vec3(...)), så både
 *    `ret = 0` og `ret.xy += v3` (HLSL skærer bare af) virker.
 *
 * Kroppen lægges i en funktion med uv, uv_orig, rad, ang (og hue_shader i comp) som parametre, som konverteren
 * gør, så shaderen må ændre uv. Konverterens hoved (hjælpefunktioner og egne teksturers uniforms) genbruges.
 * Oversættelsen er ikke fuldstændig: preset-testen afgør, om den kan linkes og tegner (scripts/convert-presets.js
 * med --alt-shaders), og ellers bruges konverterens.
 */

const TYPES = [
  [/\bfloat4x4\b/g, 'mat4'],
  [/\bfloat3x3\b/g, 'mat3'],
  [/\bfloat2x2\b/g, 'mat2'],
  [/\bhalf([1-4])?\b/g, (m, n) => (n && n !== '1' ? `vec${n}` : 'float')],
  [/\bfloat1\b/g, 'float'],
  [/\bfloat([234])\b/g, 'vec$1'],
  [/\bint([234])\b/g, 'ivec$1'],
  [/\bbool([234])\b/g, 'bvec$1'],
];

const FUNCS = [
  [/\btex2[dD]\s*\(/g, 'texture('],
  [/\btex3[dD]\s*\(/g, 'texture('],
  [/\bfrac\s*\(/g, 'fract('],
  [/\blerp\s*\(/g, '_gl_mix('],
  [/\bsaturate\s*\(/g, '_gl_saturate('],
  [/\batan2\s*\(/g, 'atan('],
  [/\bfmod\s*\(/g, 'mod('],
  [/\brsqrt\s*\(/g, 'inversesqrt('],
  [/\bddx\s*\(/g, 'dFdx('],
  [/\bddy\s*\(/g, 'dFdy('],
  [/\bmax\s*\(/g, '_gl_max('],
  [/\bmin\s*\(/g, '_gl_min('],
  [/\bpow\s*\(/g, '_gl_pow('],
  [/\bstep\s*\(/g, '_gl_step('],
];

// Hjælpefunktioner: HLSL tillader tal og vektorer blandet; GLSL ES kræver ens typer.
function helpers() {
  const out = [];
  out.push('float _gl_saturate(float x) { return clamp(x, 0.0, 1.0); }');
  for (const n of [2, 3, 4]) out.push(`vec${n} _gl_saturate(vec${n} x) { return clamp(x, 0.0, 1.0); }`);
  const two = (name, body) => {
    out.push(`float ${name}(float a, float b) { return ${body('a', 'b')}; }`);
    for (const n of [2, 3, 4]) {
      const v = `vec${n}`;
      out.push(`${v} ${name}(${v} a, ${v} b) { return ${body('a', 'b')}; }`);
      out.push(`${v} ${name}(float a, ${v} b) { return ${body(`${v}(a)`, 'b')}; }`);
      out.push(`${v} ${name}(${v} a, float b) { return ${body('a', `${v}(b)`)}; }`);
    }
  };
  two('_gl_max', (a, b) => `max(${a}, ${b})`);
  two('_gl_min', (a, b) => `min(${a}, ${b})`);
  two('_gl_pow', (a, b) => `pow(${a}, ${b})`);
  two('_gl_step', (a, b) => `step(${a}, ${b})`);
  out.push('float _gl_mix(float a, float b, float t) { return mix(a, b, t); }');
  for (const n of [2, 3, 4]) {
    const v = `vec${n}`;
    for (const [a, b, t] of [
      [v, v, 'float'],
      [v, v, v],
      ['float', v, 'float'],
      [v, 'float', 'float'],
      ['float', 'float', v],
      ['float', v, v],
      [v, 'float', v],
    ]) {
      const cast = (type, x) => (type === v ? x : `${v}(${x})`);
      out.push(`${v} _gl_mix(${a} a, ${b} b, ${t} t) { return mix(${cast(a, 'a')}, ${cast(b, 'b')}, ${cast(t, 't')}); }`);
    }
  }
  return out.join('\n');
}

/** HLSL-linjerne fra .milk-teksten (warp_1=`..., comp_1=`...), samlet. */
function extractHlsl(milkText, kind) {
  const lines = [];
  for (const line of milkText.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^${kind}_(\\d+)=\`?(.*)$`));
    if (m) lines.push([Number(m[1]), m[2]]);
  }
  lines.sort((a, b) => a[0] - b[0]);
  return lines.map((l) => l[1]).join('\n');
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Kroppen inden for shader_body { ... } og det, der står før. */
function splitBody(src) {
  const i = src.search(/\bshader_body\b/);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth += 1;
    else if (src[k] === '}') {
      depth -= 1;
      if (depth === 0) return { before: src.slice(0, i), body: src.slice(open + 1, k) };
    }
  }
  return null;
}

const blur = (n, x) => `(texture(sampler_blur${n}, ${x}).xyz*scale${n} + bias${n})`;

/** Erstatter makro(…) med fn(indhold); parenteser i argumentet tælles med. */
function replaceMacro(src, name, fn) {
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let k = m.index + m[0].length;
    for (; k < src.length && depth > 0; k++) {
      if (src[k] === '(') depth += 1;
      else if (src[k] === ')') depth -= 1;
    }
    const inner = src.slice(m.index + m[0].length, k - 1);
    out += src.slice(last, m.index) + fn(replaceMacro(inner, name, fn));
    last = k;
    re.lastIndex = k;
  }
  return out + src.slice(last);
}

/** Hele tal i regnestykker bliver kommatal (ikke i [indeks], navne, hex eller tal med komma/eksponent). */
function floatLiterals(src) {
  return src.replace(/(^|[^\w.\]])(\d+)(?![\w.]|\s*\])/g, (all, pre, num) => `${pre}${num}.0`);
}

/** Typen af hver erklæret variabel (vec3 ret osv.), til at pakke tildelinger ind. */
function declaredTypes(src, initial) {
  const types = { ...initial };
  for (const m of src.matchAll(/\b(float|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*(?==|;|,)/g)) types[m[2]] = m[1];
  return types;
}

/** Typen af et mål som "ret.xy": med swizzle er det længden. */
function targetType(target, types) {
  const [name, swz] = target.split('.');
  const base = types[name];
  if (!base) return null;
  if (!swz) return base;
  if (!/^[xyzwrgba]{1,4}$/.test(swz)) return null;
  return swz.length === 1 ? 'float' : `vec${swz.length}`;
}

/** Pakker højresiden af hver tildeling/erklæring ind i målets type: ret = vec3(...). */
function wrapAssignments(body, types) {
  return body
    .split(';')
    .map((stmt) => {
      const decl = stmt.match(/^(\s*)(float|vec[234])\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
      if (decl) return `${decl[1]}${decl[2]} ${decl[3]} = ${decl[2]}(${decl[4]})`;
      const asg = stmt.match(/^(\s*)([A-Za-z_]\w*(?:\.[xyzwrgba]{1,4})?)\s*([-+*/]?=)(?!=)\s*([\s\S]+)$/);
      if (!asg) return stmt;
      const type = targetType(asg[2], types);
      if (!type || type.startsWith('mat')) return stmt;
      return `${asg[1]}${asg[2]} ${asg[3]} ${type}(${asg[4]})`;
    })
    .join(';');
}

function translate(src) {
  let s = stripComments(src);
  for (const [re, to] of TYPES) s = s.replace(re, to);
  s = replaceMacro(s, 'GetBlur1', (x) => blur(1, x));
  s = replaceMacro(s, 'GetBlur2', (x) => blur(2, x));
  s = replaceMacro(s, 'GetBlur3', (x) => blur(3, x));
  s = replaceMacro(s, 'GetMain', (x) => `(texture(sampler_main, ${x}).xyz)`);
  s = replaceMacro(s, 'GetPixel', (x) => `(texture(sampler_main, ${x}).xyz)`);
  s = replaceMacro(s, 'lum', (x) => `(dot(${x}, vec3(0.32, 0.49, 0.29)))`);
  for (const [re, to] of FUNCS) s = s.replace(re, to);
  // HLSL-sampleres erklæringer ("sampler sampler_x;") står i konverterens hoved som uniforms.
  s = s.replace(/^\s*sampler(?:2D|3D)?\s+[^;]*;/gm, '');
  s = s.replace(/\bstatic\s+const\b/g, 'const').replace(/\bstatic\b/g, '');
  return floatLiterals(s);
}

/**
 * GLSL i Butterchurns format for én shader (kind 'warp' eller 'comp'), eller null, hvis der ingen er.
 * `converted` er konverterens udgave; dens hoved (før main_shader_sentinel) genbruges.
 */
function hlslToGlsl(milkText, kind, converted) {
  const hlsl = extractHlsl(milkText, kind);
  if (!hlsl.trim()) return null;
  const parts = splitBody(hlsl);
  if (!parts) return null;
  const header = converted && converted.includes('main_shader_sentinel') ? converted.slice(0, converted.indexOf('vec4 main_shader_sentinel')) : '';
  const params = kind === 'comp' ? 'vec2 uv, vec2 uv_orig, float rad, float ang, vec3 hue_shader' : 'vec2 uv, vec2 uv_orig, float rad, float ang';
  const args = kind === 'comp' ? 'uv, uv_orig, rad, ang, hue_shader' : 'uv, uv_orig, rad, ang';
  const before = translate(parts.before);
  let body = translate(parts.body);
  const types = declaredTypes(body, { ret: 'vec3', uv: 'vec2', uv_orig: 'vec2', rad: 'float', ang: 'float', hue_shader: 'vec3' });
  body = wrapAssignments(body, types);
  return [
    header,
    helpers(),
    before,
    `vec3 _gl_shader(${params}) {`,
    '  vec3 ret = vec3(0.0);',
    body,
    '  return ret;',
    '}',
    ` shader_body {`,
    `    ret = _gl_shader(${args});`,
    ' }',
  ].join('\n');
}

module.exports = { hlslToGlsl, translate, floatLiterals, extractHlsl, wrapAssignments };
