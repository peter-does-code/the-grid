'use strict';

const { fixTypes } = require('./glsl-types');

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
  [/\bdot\s*\(/g, '_gl_dot('],
  [/\bclamp\s*\(/g, '_gl_clamp('],
];

// Hjælpefunktioner: HLSL tillader tal og vektorer blandet; GLSL ES kræver ens typer.
// HLSL regner med den mindste fælles størrelse: et tal udvides til vektoren, og af to vektorer af forskellig
// længde skæres den længste af (float4 med float3 bliver float3). Hjælpefunktionerne findes for alle kombinationer.
const SIZES = [1, 2, 3, 4];
const typeOf = (n) => (n === 1 ? 'float' : `vec${n}`);
const resultSize = (sizes) => {
  const vecs = sizes.filter((n) => n > 1);
  return vecs.length ? Math.min(...vecs) : 1;
};
const castTo = (from, to, x) => (from === to ? x : `${typeOf(to)}(${x})`);

function overloads(name, arity, body, { returns = null } = {}) {
  const out = [];
  const combos = arity === 2 ? SIZES.flatMap((a) => SIZES.map((b) => [a, b])) : SIZES.flatMap((a) => SIZES.flatMap((b) => SIZES.map((c) => [a, b, c])));
  for (const sizes of combos) {
    const r = resultSize(sizes);
    const params = sizes.map((n, i) => `${typeOf(n)} ${'abc'[i]}`).join(', ');
    const args = sizes.map((n, i) => castTo(n, r, 'abc'[i]));
    out.push(`${returns || typeOf(r)} ${name}(${params}) { return ${body(...args)}; }`);
  }
  return out;
}

function helpers() {
  const out = [];
  out.push('float _gl_saturate(float x) { return clamp(x, 0.0, 1.0); }');
  for (const n of [2, 3, 4]) out.push(`vec${n} _gl_saturate(vec${n} x) { return clamp(x, 0.0, 1.0); }`);
  out.push(...overloads('_gl_max', 2, (a, b) => `max(${a}, ${b})`));
  out.push(...overloads('_gl_min', 2, (a, b) => `min(${a}, ${b})`));
  out.push(...overloads('_gl_pow', 2, (a, b) => `pow(${a}, ${b})`));
  out.push(...overloads('_gl_step', 2, (a, b) => `step(${a}, ${b})`));
  out.push(...overloads('_gl_dot', 2, (a, b) => `dot(${a}, ${b})`, { returns: 'float' }));
  out.push(...overloads('_gl_mix', 3, (a, b, t) => `mix(${a}, ${b}, ${t})`));
  out.push(...overloads('_gl_clamp', 3, (x, lo, hi) => `clamp(${x}, ${lo}, ${hi})`));
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
  let s = src.replace(/(^|[^\w.\]])(\d+)(?![\w.]|\s*\])/g, (all, pre, num) => `${pre}${num}.0`);
  // Heltal skal blive heltal: "int i = 0", og tallene i en for-løkkes hoved.
  s = s.replace(/\b(int\s+[A-Za-z_]\w*\s*=\s*-?)(\d+)\.0\b/g, '$1$2');
  s = s.replace(/\bfor\s*\(([^;]*);([^;]*);([^)]*)\)/g, (all, a, b, c) => `for (${[a, b, c].map((p) => p.replace(/(\d+)\.0\b/g, '$1')).join(';')})`);
  return s;
}

/** De to argumenter i et kald, delt ved kommaet på øverste niveau. */
function splitArgs(inner) {
  let depth = 0;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) return [inner.slice(0, k), inner.slice(k + 1)];
  }
  return null;
}

/**
 * HLSL's mul(a, b) er GLSL's b*a: HLSL's matricer er rækkevise (float2x2(a,b,c,d) er to rækker), GLSL's
 * søjlevise, så matricen er transponeret, og (a·b)ᵀ = bᵀ·aᵀ.
 */
function translateMul(src) {
  return replaceMacro(src, 'mul', (inner) => {
    const parts = splitArgs(inner);
    return parts ? `((${parts[1]})*(${parts[0]}))` : `mul(${inner})`;
  });
}

/**
 * Globale variable med en startværdi, der ikke er konstant (fx "float2 d = texsize.zw*2;"), må GLSL ES ikke.
 * Erklæringen bliver stående øverst, og tildelingen flyttes ind i begyndelsen af shaderens funktion.
 */
function hoistGlobals(before) {
  const kept = [];
  const assigns = [];
  let depth = 0;
  let stmt = '';
  const flush = () => {
    const m = stmt.match(/^(\s*)(?:const\s+)?(float|vec[234]|mat[234]|int)\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
    if (m && depth === 0) {
      kept.push(`${m[1]}${m[2]} ${m[3]};`);
      assigns.push(`  ${m[3]} = ${m[2]}(${m[4]});`);
    } else if (stmt.trim()) kept.push(`${stmt};`);
    stmt = '';
  };
  for (const c of before) {
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    if (c === ';' && depth === 0) flush();
    else if (c === '}' && depth === 0) {
      // Slutningen af en funktion på øverste niveau.
      kept.push(`${stmt}}`);
      stmt = '';
    } else stmt += c;
  }
  if (stmt.trim()) kept.push(stmt);
  return { code: kept.join('\n'), assigns: assigns.join('\n') };
}

// MilkDrops egne konstanter, som Butterchurns hoved ikke har.
const CONSTANTS = [
  '#define M_PI 3.14159265359',
  '#define M_PI_2 6.28318530718',
  '#define M_INV_PI 0.31830988618',
  '#define M_INV_PI_2 0.15915494309',
].join('\n');

// Butterchurns egne teksturer (erklæret i dens hoved). Forstavelserne fw_/fc_/pw_/pc_ (filter og kant) findes kun
// til main; på støj-teksturerne fjernes de.
const BUILTIN_SAMPLERS = new Set(['main', 'fw_main', 'fc_main', 'pw_main', 'pc_main', 'blur1', 'blur2', 'blur3', 'noise_lq', 'noise_lq_lite', 'noise_mq', 'noise_hq', 'pw_noise_lq', 'noisevol_lq', 'noisevol_hq']);
const BUILTIN_TEXSIZE = new Set(['noise_lq', 'noise_mq', 'noise_hq', 'noise_lq_lite', 'noisevol_lq', 'noisevol_hq']);

/**
 * Presettets egne teksturer (fx sampler_prayerwheel) erklæres som "uniform sampler2D sampler_x;": det er dén
 * linje, Butterchurn leder efter for at indlæse billedet (getUserSamplers). Deres texsize_x sætter Butterchurn
 * ikke, så den får en fast størrelse.
 */
function textureDeclarations(code, header) {
  let s = code.replace(/\bsampler_(?:fw|fc|pw|pc)_(noise(?:vol)?_(?:lq_lite|lq|mq|hq))\b/g, (all, base) => (base === 'noise_lq' && /pw_/.test(all) ? 'sampler_pw_noise_lq' : `sampler_${base}`));
  s = s.replace(/\btexsize_(?:fw|fc|pw|pc)_(noise(?:vol)?_(?:lq_lite|lq|mq|hq))\b/g, 'texsize_$1');
  const decls = [];
  for (const name of new Set([...s.matchAll(/\bsampler_(\w+)/g)].map((m) => m[1]))) {
    if (BUILTIN_SAMPLERS.has(name) || header.includes(`sampler_${name};`)) continue;
    decls.push(`uniform sampler2D sampler_${name};`);
  }
  for (const name of new Set([...s.matchAll(/\btexsize_(\w+)/g)].map((m) => m[1]))) {
    if (BUILTIN_TEXSIZE.has(name) || header.includes(`texsize_${name};`)) continue;
    decls.push(`const vec4 texsize_${name} = vec4(256.0, 256.0, 1.0/256.0, 1.0/256.0);`);
  }
  return { code: s, decls: decls.join('\n') };
}

/** HLSL tillader .x på et tal (float1); GLSL ikke. "d.x" bliver til "d", når d er et tal. */
function scalarSwizzles(src, types) {
  return src.replace(/\b([A-Za-z_]\w*)\.([xr])\b(?![\w.])/g, (all, name) => (types[name] === 'float' ? name : all));
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
  s = translateMul(s);
  for (const [re, to] of FUNCS) s = s.replace(re, to);
  // tex2D(...) uden swizzle er 4 værdier, som HLSL skærer ned til 3 ved siden af en farve ("ret * tex2D(...)");
  // GLSL nægter. MilkDrops shadere regner næsten altid i farver, så der sættes .xyz på.
  s = replaceMacro(s, 'texture', (inner) => `texture(${inner})\u0000`).replace(/\u0000(?!\s*\.)/g, '.xyz').replace(/\u0000/g, '');
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
  // Fra konverterens hoved kun erklæringerne af presettets egne teksturer (uniform sampler2D sampler_x og
  // texsize_x): resten (presettets egne variable og funktioner) oversættes her, og to udgaver gav "redefinition".
  const header = converted
    ? converted
        .split('\n')
        .filter((l) => /^\s*uniform\s/.test(l))
        .join('\n')
    : '';
  const params = kind === 'comp' ? 'vec2 uv, vec2 uv_orig, float rad, float ang, vec3 hue_shader' : 'vec2 uv, vec2 uv_orig, float rad, float ang';
  const args = kind === 'comp' ? 'uv, uv_orig, rad, ang, hue_shader' : 'uv, uv_orig, rad, ang';
  const globals = hoistGlobals(translate(parts.before));
  let body = translate(parts.body);
  const types = declaredTypes(`${globals.code}\n${body}`, { ret: 'vec3', uv: 'vec2', uv_orig: 'vec2', rad: 'float', ang: 'float', hue_shader: 'vec3' });
  body = scalarSwizzles(wrapAssignments(body, types), types);
  const main = [
    scalarSwizzles(globals.code, types),
    `vec3 _gl_shader(${params}) {`,
    '  vec3 ret = vec3(0.0);',
    globals.assigns,
    body,
    '  return ret;',
    '}',
  ].join('\n');
  const tex = textureDeclarations(main, header);
  // HLSL's stille omregninger mellem tal og vektorer skrives ud (scripts/lib/glsl-types.js). Kan koden ikke
  // læses, bruges den som den er.
  try {
    tex.code = fixTypes(tex.code);
  } catch {
    // uændret
  }
  return [header, tex.decls, CONSTANTS, helpers(), tex.code, ` shader_body {`, `    ret = _gl_shader(${args});`, ' }'].join('\n');
}

module.exports = { hlslToGlsl, translate, floatLiterals, extractHlsl, wrapAssignments };
