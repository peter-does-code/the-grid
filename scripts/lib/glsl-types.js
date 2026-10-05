'use strict';

/*
 * Typerne i en oversat MilkDrop-shader (scripts/lib/hlsl-to-glsl.js), så HLSL's stille omregninger kan skrives ud,
 * som GLSL kræver (05-10-2026: over 600 shadere fejlede på "wrong operand types" og "dimension mismatch"):
 *  - vektorer af forskellig længde: HLSL skærer den længste af (float3 + float2 → float2); her vec2(...) om den;
 *  - et tal ved en vektor udvides af GLSL selv, men et heltal ved et kommatal ikke: float(...) om heltallet;
 *  - % på kommatal: mod(a, b);
 *  - .x/.xx på et tal: tallet eller vecN(tal);
 *  - sandt/falsk i regnestykker (HLSL regner dem som 1/0): float(...);
 *  - argumenter til presettets egne funktioner og tildelinger: målets type.
 *
 * Koden læses med en lille parser (udtryk med præcedens, erklæringer, if/for/while/return, funktioner) og skrives
 * ud igen med parenteser om hvert regnestykke. Kan den ikke læse koden, kaster den, og kalderen beholder den
 * oprindelige.
 */

const TOKEN = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]\w*|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?|\+\+|--|[-+*/%]=|==|!=|<=|>=|&&|\|\||[-+*/%<>=!?:.,;(){}[\]]/gy;

function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m || m.index !== start) throw new Error(`unexpected character at ${start}: ${src.slice(start, start + 20)}`);
    if (/^\s|^\/[/*]/.test(m[0])) continue;
    out.push(m[0]);
  }
  return out;
}

const TYPE_NAMES = new Set(['void', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler3D']);
const QUALIFIERS = new Set(['const', 'in', 'out', 'inout', 'uniform', 'highp', 'mediump', 'lowp']);

const size = (t) => {
  if (!t) return null;
  if (t === 'float' || t === 'int' || t === 'bool') return 1;
  const m = t.match(/^[ib]?vec([234])$/);
  return m ? Number(m[1]) : null;
};
const isMat = (t) => /^mat[234]$/.test(t || '');
const vecOf = (n) => (n === 1 ? 'float' : `vec${n}`);

// Kendte navne fra Butterchurns hoved.
const GLOBALS = {
  time: 'float', fps: 'float', frame: 'float', progress: 'float', decay: 'float',
  bass: 'float', mid: 'float', treb: 'float', vol: 'float', bass_att: 'float', mid_att: 'float', treb_att: 'float', vol_att: 'float',
  rad: 'float', ang: 'float', uv: 'vec2', uv_orig: 'vec2', ret: 'vec3', hue_shader: 'vec3',
  texsize: 'vec4', aspect: 'vec4', resolution: 'vec2', roam_cos: 'vec4', roam_sin: 'vec4', slow_roam_cos: 'vec4', slow_roam_sin: 'vec4',
  rand_frame: 'vec4', rand_preset: 'vec4', fShader: 'float', gammaAdj: 'float', echo_zoom: 'float', echo_alpha: 'float', echo_orientation: 'float',
  M_PI: 'float', M_PI_2: 'float', M_INV_PI: 'float', M_INV_PI_2: 'float', PI: 'float',
};
for (let i = 1; i <= 32; i++) GLOBALS[`q${i}`] = 'float';
for (const n of [1, 2, 3]) Object.assign(GLOBALS, { [`scale${n}`]: 'float', [`bias${n}`]: 'float', [`blur${n}_min`]: 'float', [`blur${n}_max`]: 'float' });

const SAME_AS_ARG = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'fract', 'normalize', 'radians', 'degrees', 'dFdx', 'dFdy', 'fwidth', 'trunc', 'round', 'sinh', 'cosh', 'tanh', '_gl_saturate']);
const TO_FLOAT = new Set(['length', 'distance', 'dot', '_gl_dot', 'determinant']);
const SAME_SIZE_ARGS = new Set(['distance', 'reflect', 'mod', 'atan', 'faceforward']); // HLSL: alle vektorer til den mindste
const HELPERS = /^_gl_(max|min|pow|step|mix|clamp)$/;

class Parser {
  constructor(tokens, functions) {
    this.t = tokens;
    this.i = 0;
    this.functions = functions; // navn → { ret, params: [type] }
    this.scopes = [{ ...GLOBALS }];
  }

  peek(k = 0) {
    return this.t[this.i + k];
  }

  next() {
    return this.t[this.i++];
  }

  expect(tok) {
    const got = this.next();
    if (got !== tok) throw new Error(`expected ${tok}, got ${got}`);
    return got;
  }

  typeOfName(name) {
    for (let s = this.scopes.length - 1; s >= 0; s--) if (name in this.scopes[s]) return this.scopes[s][name];
    if (/^sampler_.*noisevol/.test(name)) return 'sampler3D';
    if (/^sampler_/.test(name)) return 'sampler2D';
    if (/^texsize_/.test(name)) return 'vec4';
    return null;
  }

  declare(name, type) {
    this.scopes[this.scopes.length - 1][name] = type;
  }

  // ---- Program og sætninger ----

  program() {
    const out = [];
    while (this.i < this.t.length) out.push(this.topLevel());
    return out.join('\n');
  }

  qualifiers() {
    const q = [];
    while (QUALIFIERS.has(this.peek())) q.push(this.next());
    return q.length ? `${q.join(' ')} ` : '';
  }

  topLevel() {
    const q = this.qualifiers();
    if (TYPE_NAMES.has(this.peek()) && /^[A-Za-z_]\w*$/.test(this.peek(1) || '') && this.peek(2) === '(') return q + this.functionDef();
    if (this.peek() === 'struct') throw new Error('struct not supported');
    return q + this.statement();
  }

  functionDef() {
    const ret = this.next();
    const name = this.next();
    this.expect('(');
    const params = [];
    const typed = [];
    this.scopes.push({});
    while (this.peek() !== ')') {
      const q = this.qualifiers();
      const type = this.next();
      const pname = this.next();
      this.declare(pname, type);
      params.push(`${q}${type} ${pname}`);
      typed.push(type);
      if (this.peek() === ',') this.next();
    }
    this.expect(')');
    this.functions[name] = { ret, params: typed };
    if (this.peek() === ';') {
      this.next();
      this.scopes.pop();
      return `${ret} ${name}(${params.join(', ')});`;
    }
    this.returnType = ret;
    const body = this.block();
    this.scopes.pop();
    return `${ret} ${name}(${params.join(', ')}) ${body}`;
  }

  block() {
    this.expect('{');
    this.scopes.push({});
    const out = [];
    while (this.peek() !== '}') {
      if (this.peek() === undefined) throw new Error('unterminated block');
      out.push(this.statement());
    }
    this.next();
    this.scopes.pop();
    return `{\n${out.join('\n')}\n}`;
  }

  statement() {
    const tok = this.peek();
    if (tok === '{') return this.block();
    if (tok === ';') {
      this.next();
      return ';';
    }
    if (tok === 'if') {
      this.next();
      this.expect('(');
      const cond = this.condition();
      this.expect(')');
      let s = `if (${cond}) ${this.statement()}`;
      if (this.peek() === 'else') {
        this.next();
        s += ` else ${this.statement()}`;
      }
      return s;
    }
    if (tok === 'for') {
      this.next();
      this.expect('(');
      this.scopes.push({});
      const init = this.peek() === ';' ? '' : this.simpleStatement();
      this.expect(';');
      const cond = this.peek() === ';' ? '' : this.condition();
      this.expect(';');
      const step = this.peek() === ')' ? '' : this.expressionStatement();
      this.expect(')');
      const body = this.statement();
      this.scopes.pop();
      return `for (${init}; ${cond}; ${step}) ${body}`;
    }
    if (tok === 'while') {
      this.next();
      this.expect('(');
      const cond = this.condition();
      this.expect(')');
      return `while (${cond}) ${this.statement()}`;
    }
    if (tok === 'return') {
      this.next();
      if (this.peek() === ';') {
        this.next();
        return 'return;';
      }
      const e = this.expr();
      this.expect(';');
      return `return ${this.cast(e, this.returnType)};`;
    }
    if (tok === 'break' || tok === 'continue' || tok === 'discard') {
      this.next();
      this.expect(';');
      return `${tok};`;
    }
    const s = this.simpleStatement();
    this.expect(';');
    return `${s};`;
  }

  /** En erklæring eller et udtryk (uden afsluttende semikolon). */
  simpleStatement() {
    const q = this.qualifiers();
    if (TYPE_NAMES.has(this.peek()) && /^[A-Za-z_]\w*$/.test(this.peek(1) || '') && this.peek(2) !== '(') {
      const type = this.next();
      const parts = [];
      for (;;) {
        const name = this.next();
        let part = name;
        if (this.peek() === '[') {
          this.next();
          const n = this.expr();
          this.expect(']');
          part += `[${n.code}]`;
          this.declare(name, `${type}[]`);
        } else this.declare(name, type);
        if (this.peek() === '=') {
          this.next();
          part += ` = ${this.cast(this.assignment(), type)}`;
        }
        parts.push(part);
        if (this.peek() !== ',') break;
        this.next();
      }
      return `${q}${type} ${parts.join(', ')}`;
    }
    return q + this.expressionStatement();
  }

  expressionStatement() {
    return this.assignment().code;
  }

  condition() {
    const e = this.expr();
    return e.type === 'float' || e.type === 'int' ? `(${e.code} != 0.0)` : e.code;
  }

  // ---- Udtryk ----

  /** Et udtryk pakket i en anden type, som HLSL ville have regnet om. */
  cast(e, to) {
    if (!to || !e.type || e.type === to) return e.code;
    const from = size(e.type);
    const target = size(to);
    if (from === null || target === null) return e.code;
    if (to === 'int' || to === 'bool') return `${to}(${e.code})`;
    if (from === 1 || from > target || e.type !== vecOf(from)) return `${to}(${e.code})`;
    return e.code; // en mindre vektor kan ikke blive større; lad GLSL melde fejlen
  }

  expr() {
    let e = this.assignment();
    while (this.peek() === ',') {
      this.next();
      const r = this.assignment();
      e = { code: `${e.code}, ${r.code}`, type: r.type };
    }
    return e;
  }

  assignment() {
    const left = this.ternary();
    const op = this.peek();
    if (['=', '+=', '-=', '*=', '/=', '%='].includes(op)) {
      this.next();
      const right = this.assignment();
      if (op === '%=') return { code: `${left.code} = mod(${left.code}, ${this.cast(right, left.type)})`, type: left.type };
      if (op === '*=' && isMat(right.type)) return { code: `${left.code} ${op} ${right.code}`, type: left.type };
      return { code: `${left.code} ${op} ${this.cast(right, left.type)}`, type: left.type };
    }
    return left;
  }

  ternary() {
    const cond = this.binary(0);
    if (this.peek() !== '?') return cond;
    this.next();
    const a = this.assignment();
    this.expect(':');
    const b = this.assignment();
    const t = this.unify(a.type, b.type);
    const c = cond.type === 'float' || cond.type === 'int' ? `(${cond.code} != 0.0)` : cond.code;
    return { code: `(${c} ? ${this.cast(a, t)} : ${this.cast(b, t)})`, type: t };
  }

  unify(a, b) {
    const sa = size(a);
    const sb = size(b);
    if (sa === null || sb === null) return a || b;
    if (sa === 1 && sb === 1) return a === 'int' && b === 'int' ? 'int' : 'float';
    if (sa === 1) return vecOf(sb);
    if (sb === 1) return vecOf(sa);
    return vecOf(Math.min(sa, sb));
  }

  binary(level) {
    const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    if (level >= LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (LEVELS[level].includes(this.peek())) {
      const op = this.next();
      const right = this.binary(level + 1);
      left = this.combine(op, left, right);
    }
    return left;
  }

  /** Et tal i et regnestykke: sandt/falsk og heltal bliver kommatal, som i HLSL. */
  numeric(e) {
    if (e.type === 'bool' || e.type === 'int') return { code: `float(${e.code})`, type: 'float' };
    const s = size(e.type);
    if (s && s > 1 && /^[ib]vec/.test(e.type)) return { code: `vec${s}(${e.code})`, type: `vec${s}` };
    return e;
  }

  combine(op, a, b) {
    if (op === '||' || op === '&&') {
      const cond = (e) => (e.type === 'bool' ? e.code : `(${e.code} != 0.0)`);
      return { code: `(${cond(a)} ${op} ${cond(b)})`, type: 'bool' };
    }
    if (!a.type || !b.type) return { code: `(${a.code} ${op === '%' ? '%' : op} ${b.code})`.replace(/^\((.*) % (.*)\)$/, 'mod($1, $2)'), type: a.type || b.type };
    if (isMat(a.type) || isMat(b.type)) {
      const t = isMat(a.type) && isMat(b.type) ? a.type : isMat(a.type) ? (size(b.type) > 1 ? b.type : a.type) : size(a.type) > 1 ? a.type : b.type;
      return { code: `(${a.code} ${op} ${b.code})`, type: t };
    }
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      const n = Math.max(size(a.type), size(b.type));
      if (n === 1) {
        const x = this.numeric(a);
        const y = this.numeric(b);
        return { code: `(${x.code} ${op} ${y.code})`, type: 'bool' };
      }
      // HLSL sammenligner vektorer komponentvis; resultatet bruges som 0/1-vektor.
      const t = vecOf(Math.min(...[size(a.type), size(b.type)].filter((s) => s > 1)));
      const fn = { '<': 'lessThan', '>': 'greaterThan', '<=': 'lessThanEqual', '>=': 'greaterThanEqual', '==': 'equal', '!=': 'notEqual' }[op];
      return { code: `${t}(${fn}(${this.cast(this.numeric(a), t)}, ${this.cast(this.numeric(b), t)}))`, type: t };
    }
    const x = this.numeric(a);
    const y = this.numeric(b);
    const t = this.unify(x.type, y.type);
    const cx = size(x.type) === 1 ? x.code : this.cast(x, t);
    const cy = size(y.type) === 1 ? y.code : this.cast(y, t);
    if (op === '%') return { code: `mod(${size(x.type) === 1 && size(t) > 1 ? `${t}(${cx})` : cx}, ${cy})`, type: t };
    return { code: `(${cx} ${op} ${cy})`, type: t };
  }

  unary() {
    const tok = this.peek();
    if (tok === '-' || tok === '+' || tok === '!') {
      this.next();
      const e = this.unary();
      if (tok === '+') return e;
      if (tok === '!') return { code: `!(${e.type === 'bool' ? e.code : `${e.code} != 0.0`})`, type: 'bool' };
      return { code: `(-${e.code})`, type: e.type };
    }
    if (tok === '++' || tok === '--') {
      this.next();
      const e = this.unary();
      return { code: `${tok}${e.code}`, type: e.type };
    }
    return this.postfix(this.primary());
  }

  postfix(e) {
    for (;;) {
      const tok = this.peek();
      if (tok === '.') {
        this.next();
        const swz = this.next();
        if (!/^[xyzwrgba]{1,4}$/.test(swz)) {
          e = { code: `${e.code}.${swz}`, type: null };
          continue;
        }
        if (size(e.type) === 1) {
          // .x/.xx på et tal
          e = swz.length === 1 ? e : { code: `vec${swz.length}(${e.code})`, type: `vec${swz.length}` };
        } else e = { code: `${e.code}.${swz}`, type: e.type ? vecOf(swz.length) : null };
      } else if (tok === '[') {
        this.next();
        const idx = this.expr();
        this.expect(']');
        const t = e.type && e.type.endsWith('[]') ? e.type.slice(0, -2) : isMat(e.type) ? vecOf(Number(e.type.slice(3))) : size(e.type) > 1 ? 'float' : null;
        e = { code: `${e.code}[int(${idx.code})]`, type: t };
      } else if (tok === '++' || tok === '--') {
        this.next();
        e = { code: `${e.code}${tok}`, type: e.type };
      } else return e;
    }
  }

  primary() {
    const tok = this.next();
    if (tok === undefined) throw new Error('unexpected end');
    if (tok === '(') {
      const e = this.expr();
      this.expect(')');
      return { code: `(${e.code})`, type: e.type };
    }
    if (/^(\d|\.\d)/.test(tok)) return { code: tok, type: /[.eE]/.test(tok) ? 'float' : 'int' };
    if (tok === 'true' || tok === 'false') return { code: tok, type: 'bool' };
    if (!/^[A-Za-z_]\w*$/.test(tok)) throw new Error(`unexpected ${tok}`);
    if (this.peek() === '(') return this.call(tok);
    return { code: tok, type: this.typeOfName(tok) };
  }

  call(name) {
    this.expect('(');
    const args = [];
    while (this.peek() !== ')') {
      args.push(this.assignment());
      if (this.peek() === ',') this.next();
      else if (this.peek() !== ')') throw new Error(`bad argument list in ${name}`);
    }
    this.expect(')');
    const codes = args.map((a) => a.code);
    // Konstruktører
    if (TYPE_NAMES.has(name)) {
      const parts = args.map((a) => this.numeric(a));
      return { code: `${name}(${parts.map((p) => p.code).join(', ')})`, type: name };
    }
    // Presettets egne funktioner: argumenterne til parametrenes typer.
    const fn = this.functions[name];
    if (fn) {
      const cast = args.map((a, k) => this.cast(a, fn.params[k]));
      return { code: `${name}(${cast.join(', ')})`, type: fn.ret === 'void' ? null : fn.ret };
    }
    if (name === 'texture') {
      const sampler = args[0] && args[0].type;
      const want = sampler === 'sampler3D' ? 'vec3' : 'vec2';
      const coord = args[1] ? this.cast(args[1], want) : '';
      return { code: `texture(${[codes[0], coord, ...codes.slice(2)].join(', ')})`, type: 'vec4' };
    }
    if (TO_FLOAT.has(name) || SAME_SIZE_ARGS.has(name) || SAME_AS_ARG.has(name) || HELPERS.test(name) || name === 'cross' || name === 'smoothstep') {
      let list = args.map((a) => this.numeric(a));
      if (SAME_SIZE_ARGS.has(name) || name === 'smoothstep') {
        const vecs = list.map((a) => size(a.type)).filter((s) => s > 1);
        if (vecs.length && list.every((a) => size(a.type) !== null)) {
          const t = vecOf(Math.min(...vecs));
          list = list.map((a) => ({ code: this.cast(a, t), type: t }));
        }
      }
      const code = `${name}(${list.map((a) => a.code).join(', ')})`;
      if (TO_FLOAT.has(name)) return { code, type: 'float' };
      if (name === 'cross') return { code, type: 'vec3' };
      if (HELPERS.test(name)) {
        const sizes = list.map((a) => size(a.type));
        if (sizes.some((s) => s === null)) return { code, type: null };
        const vecs = sizes.filter((s) => s > 1);
        return { code, type: vecs.length ? vecOf(Math.min(...vecs)) : 'float' };
      }
      return { code, type: list.length ? list[list.length - 1].type && (name === 'smoothstep' ? list[2].type : list[0].type) : null };
    }
    return { code: `${name}(${codes.join(', ')})`, type: null };
  }
}

/** Typerne skrevet ud i GLSL-koden (globale erklæringer, funktioner og shaderens funktion). Kaster ved fejl. */
function fixTypes(code) {
  const lines = code.split('\n');
  const pre = lines.filter((l) => /^\s*#/.test(l));
  const rest = lines.filter((l) => !/^\s*#/.test(l)).join('\n');
  const parser = new Parser(tokenize(rest), {});
  return [...pre, parser.program()].join('\n');
}

module.exports = { fixTypes, tokenize };
