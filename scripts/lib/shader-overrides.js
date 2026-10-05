'use strict';

/*
 * Håndoversatte shadere til presets, som milkdrop-preset-converter (hlslparser-js) oversætter forkert, så de
 * tegner hvidt eller sort. Bruges af scripts/convert-presets.js i stedet for konverterens warp/comp.
 *
 * Fundet 05-10-2026 på "Flexi - shader circus" (slægtninge af "Flexi - oldschool tree", Peters "the fern"):
 * parseren mister operatoren i lange udtryk som `a + b - c - d*e*4` og ved GetBlur-makroerne og skriver `&&`
 * i stedet for plus, minus og gange. `ret.x += (...)*0.4 + 0.004` blev til `bool(...) && bool(0.004)`, så
 * den røde kanal steg med 1 pr. billede og billedet blev hvidt. scripts/lib/repair-shader.js gætter "+", hvilket
 * er rigtigt det meste af tiden, men ikke her; derfor håndoversættes de.
 *
 * Formatet er Butterchurns: hjælpefunktioner før `shader_body { ... }`, kroppen skriver `ret`. GetBlurN(uv) er
 * (texture(sampler_blurN, uv).xyz*scaleN + biasN), og i comp er `hue_shader` og `uv` til rådighed.
 */

const blur = (n, uv) => `(texture(sampler_blur${n}, ${uv}).xyz*scale${n} + bias${n})`;

// Fælles warp for begge "shader circus": reaktion-diffusion i rødt, kopieret grønt spor.
const CIRCUS_WARP = ` shader_body {
  ret = vec3(0.0);
  vec2 d = texsize.zw*2.0;
  vec3 dx = ${blur(1, 'uv_orig + vec2(1.0, 0.0)*d')} - ${blur(1, 'uv_orig - vec2(1.0, 0.0)*d')};
  vec3 dy = ${blur(1, 'uv_orig + vec2(0.0, 1.0)*d')} - ${blur(1, 'uv_orig - vec2(0.0, 1.0)*d')};
  vec2 uv_red = 0.5 + (uv - 0.5)*0.996 - vec2(0.0, 1.0)*texsize.zw - vec2(dx.x, dy.y)*texsize.zw*4.0;
  uv_red = fract(uv_red);
  ret.x = texture(sampler_main, uv_red).x;
  ret.x += (vec3(ret.x) - ${blur(2, 'uv_red')}).x*0.4 + 0.004;
  vec2 uv_green = mix(uv_orig, uv, 2.0) + vec2(0.0, 1.0)*texsize.zw - vec2(dx.y, dy.y)*texsize.zw*2.0 + vec2(dy.z, -dx.z)*texsize.zw*16.0;
  ret.y = max(clamp(${blur(1, 'uv_orig')}.x - 0.4, 0.0, 1.0)*1.2*ret.x, texture(sampler_fc_main, uv_green).y - 0.004);
 }`;

const OVERRIDES = {
  'Flexi - shader circus [21 know how]': {
    warp: CIRCUS_WARP,
    comp: ` shader_body {
  vec2 uv2 = 0.5 + (uv - 0.5)*vec2(1.0, -1.0);
  ret = mix(vec3(0.2, 0.0, 0.1), vec3(1.0, 0.5, 0.0), ${blur(3, 'uv2')}.x*2.0);
  ret = mix(ret, pow(hue_shader, vec3(6.0)), ${blur(1, 'uv2')}.y*1.4);
 }`,
  },
  'Flexi - shader circus [25 another try]': {
    warp: CIRCUS_WARP,
    comp: ` shader_body {
  vec2 uv2 = 0.5 + (uv - 0.5)*vec2(1.0, -1.0);
  vec2 d = texsize.zw*4.0;
  vec3 dx = ${blur(1, 'uv2 + vec2(1.0, 0.0)*d')} - ${blur(1, 'uv2 - vec2(1.0, 0.0)*d')};
  vec3 dy = ${blur(1, 'uv2 + vec2(0.0, 1.0)*d')} - ${blur(1, 'uv2 - vec2(0.0, 1.0)*d')};
  vec2 uv_x = uv2 - vec2(dx.y, dy.y)*0.1;
  ret = ${blur(2, 'uv_x')}.x*vec3(0.0, 0.0, 2.0);
  ret = mix(ret, vec3(1.2), ${blur(1, 'uv_x')}.x);
 }`,
  },
};

/** Håndoversatte shadere for presettet, eller null. */
function shaderOverride(name) {
  return OVERRIDES[name] || null;
}

module.exports = { shaderOverride, OVERRIDES };
