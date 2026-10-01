'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { repairShader } = require('../scripts/lib/repair-shader');

test('plus, som hlslparser-js gjorde til && mellem bvec-konverteringer, bliver plus igen', () => {
  const broken = 'texture(sampler_noise_lq, vec2 ((bvec4 ((uv * vec2 (0.3)), 0, 0) && bvec4 ((vec4 (0.01) * rand_frame)))))';
  assert.equal(repairShader(broken), 'texture(sampler_noise_lq, vec2 ((vec4 ((uv * vec2 (0.3)), 0, 0) + vec4 ((vec4 (0.01) * rand_frame)))))');
});

test('kæder og indlejrede parenteser rettes også', () => {
  const broken = '(ret = vec3 ((bvec3 ((vec3 (0.95) * crisp1)) && (bvec3 ((noiseVal - vec3 (0.02))) && bvec3 ((0.06 * blur))))));';
  assert.equal(repairShader(broken), '(ret = vec3 ((vec3 ((vec3 (0.95) * crisp1)) + (vec3 ((noiseVal - vec3 (0.02))) + vec3 ((0.06 * blur))))));');
});

test('presettets funktion får rad, ang og uv_orig (og hue_shader i comp) med som parametre', () => {
  const src = 'vec4 main_shader_sentinel(vec2 uv) {\n  vec3 ret = vec3(rad);\n  return vec4(ret, 1.0);\n}\n shader_body {\n  vec4 result = main_shader_sentinel(uv);\n  ret = result.rgb;\n }';
  const warp = repairShader(src, 'warp');
  assert.ok(warp.includes('vec4 main_shader_sentinel(vec2 uv, vec2 uv_orig, float rad, float ang) {'));
  assert.ok(warp.includes('main_shader_sentinel(uv, uv_orig, rad, ang);'));
  const comp = repairShader(src, 'comp');
  assert.ok(comp.includes('float ang, vec3 hue_shader)') && comp.includes('rad, ang, hue_shader);'));
  assert.equal(repairShader(warp, 'warp'), warp, 'kan køres to gange');
});

test('egne teksturer får uniform, og Butterchurns egne erklæres ikke igen', () => {
  const src = 'sampler2D sampler_clouds;\nuniform sampler2D sampler_main;\n   sampler3D sampler_vol;\nvec4 f() { return vec4(0.0); }';
  assert.equal(repairShader(src), 'uniform sampler2D sampler_clouds;\n\nuniform sampler3D sampler_vol;\nvec4 f() { return vec4(0.0); }');
});

test('et rigtigt logisk og og bvec-hjælpefunktionerne røres ikke', () => {
  const ok = 'if ((q25 > 1.0) && (q26 < 2.0)) { x = 1.0; }\nvec2 bvecTernary0(bvec2 cond, vec2 a, vec2 b) { return a; }';
  assert.equal(repairShader(ok), ok);
});
