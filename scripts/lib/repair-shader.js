'use strict';

/*
 * Retter en fejl i hlslparser-js (bruges af milkdrop-preset-converter): HLSL-plus mellem to udtryk bliver
 * oversat til et logisk og mellem to boolske vektorer, fx
 *
 *   HLSL:  tex2D(sampler_noise_lq, uv*.3 + .01*rand_frame)
 *   ud:    texture(sampler_noise_lq, vec2 ((bvec4 ((uv * vec2 (0.3)), 0, 0) && bvec4 ((vec4 (0.01) * rand_frame)))))
 *
 * GLSL afviser det, så shaderen ikke kan linkes, og presettet tegner sort. Mønsteret er fast: begge sider af
 * "&&" er omsluttet af en "bvecN (...)"-konvertering. Sådan et "&&" bliver til "+", og "bvecN (" til "vecN (".
 * Et rigtigt logisk og (fx "if (a > b && c < d)") har ikke den omslutning og røres ikke.
 */

const BVEC = /bvec([234]) \(/g;

/** Er teksten fra position i (efter mellemrum og startparenteser) en "bvecN ("-konvertering? */
function startsWithBvec(text, i) {
  while (i < text.length && (text[i] === ' ' || text[i] === '(')) i += 1;
  return text.startsWith('bvec', i) && /^bvec[234] \(/.test(text.slice(i, i + 7));
}

/** Slutter teksten før position i (før mellemrum og slutparenteser) med en afsluttet "bvecN (...)"? */
function endsWithBvec(text, i) {
  let j = i - 1;
  while (j >= 0 && text[j] === ' ') j -= 1;
  // Gå baglæns over afsluttende parenteser og find den, der åbner den inderste afsluttede gruppe.
  let depth = 0;
  for (let k = j; k >= 0; k -= 1) {
    const c = text[k];
    if (c === ')') depth += 1;
    else if (c === '(') {
      depth -= 1;
      if (depth === 0) {
        // k er "(" for det udtryk, der slutter lige før "&&". Er det "bvecN (" eller "(bvecN ("?
        const before = text.slice(Math.max(0, k - 6), k);
        if (/bvec[234] $/.test(before)) return true;
        return startsWithBvec(text, k);
      }
    }
    if (depth < 0) return false;
  }
  return false;
}

function repairPlus(text) {
  if (!text.includes('bvec')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('&&', i);
    if (at < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    out += endsWithBvec(text, at) && startsWithBvec(text, at + 2) ? '+' : '&&';
    i = at + 2;
  }
  return out.replace(BVEC, 'vec$1 (');
}

// Teksturer, Butterchurn selv erklærer i sine shadere: en erklæring mere giver "redefinition".
const BUILTIN_SAMPLERS = new Set([
  'sampler_main',
  'sampler_fw_main',
  'sampler_fc_main',
  'sampler_pw_main',
  'sampler_pc_main',
  'sampler_blur1',
  'sampler_blur2',
  'sampler_blur3',
  'sampler_noise_lq',
  'sampler_noise_lq_lite',
  'sampler_noise_mq',
  'sampler_noise_hq',
  'sampler_pw_noise_lq',
  'sampler_noisevol_lq',
  'sampler_noisevol_hq',
]);

/**
 * Teksturer i presettets egen del (før funktionerne): GLSL kræver "uniform" foran, og Butterchurn finder
 * presettets egne teksturer (fx sampler_clouds) netop ud fra "uniform sampler2D sampler_...;".
 */
function repairSamplers(text) {
  return text.replace(/^[ \t]*(?:uniform[ \t]+)?(sampler2D|sampler3D)[ \t]+(\w+)[ \t]*;[ \t]*$/gm, (line, type, name) =>
    BUILTIN_SAMPLERS.has(name) ? '' : `uniform ${type} ${name};`
  );
}

/**
 * Konverteren lægger presettets kode i en funktion, main_shader_sentinel(uv), som shader_body kalder. Men
 * MilkDrops værdier rad, ang og uv_orig (og hue_shader i comp-shaderen) findes kun inde i Butterchurns
 * main(), så funktionen ikke kan se dem ("undeclared identifier"). De gives med som parametre.
 */
function repairSentinel(text, kind) {
  const params = ['vec2 uv', 'vec2 uv_orig', 'float rad', 'float ang'];
  const args = ['uv', 'uv_orig', 'rad', 'ang'];
  if (kind === 'comp') {
    params.push('vec3 hue_shader');
    args.push('hue_shader');
  }
  return text
    .replace(/vec4 main_shader_sentinel\(vec2 uv\)/, `vec4 main_shader_sentinel(${params.join(', ')})`)
    .replace(/main_shader_sentinel\(uv\)/, `main_shader_sentinel(${args.join(', ')})`);
}

/** Retter en shader fra milkdrop-preset-converter (kind: 'warp' eller 'comp'). */
function repairShader(text, kind = 'warp') {
  if (typeof text !== 'string' || !text) return text;
  return repairSentinel(repairSamplers(repairPlus(text)), kind);
}

module.exports = { repairShader };
