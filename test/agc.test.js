'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Agc, AGC_DEFAULTS } = require('../src/shared/agc.js');

const FPS = 60;
const fromDb = (db) => Math.pow(10, db / 20);

/**
 * Kører trimmen fra `from` til `to` sekunder med 60 billeder i sekundet. `rms(t)` er det rå niveau.
 * Lyden i et billede går gennem forstærkningen fra billedet før (sådan virker lydkæden i music.js), så
 * `out` = rms × forstærkningen før opdateringen. Returnerer [{ t, rms, out, gain }].
 */
function run(agc, from, to, rms, { silent = false } = {}) {
  const frames = [];
  for (let k = Math.round(from * FPS); k < Math.round(to * FPS); k++) {
    const t = k / FPS;
    const level = rms(t);
    const before = agc.gain;
    const gain = agc.update(t, level, { silent });
    frames.push({ t, rms: level, out: level * before, gain });
  }
  return frames;
}

const constant = (db) => () => fromDb(db);

test('trin fra -24 dB til -14 dB: det høje forbliver højere end det stille i mindst 5 s (ingen invertering)', () => {
  const agc = new Agc();
  const before = run(agc, 0, 60, constant(-24));
  const preStep = before[before.length - 1].out;
  assert.ok(Math.abs(preStep - AGC_DEFAULTS.targetRms) < 0.01, `før trinnet ${preStep.toFixed(3)} (mål ${AGC_DEFAULTS.targetRms})`);

  const after = run(agc, 60, 240, constant(-14));
  const first5 = after.filter((f) => f.t < 65);
  for (const f of first5) assert.ok(f.out > preStep, `${(f.t - 60).toFixed(2)} s efter trinnet: ${f.out.toFixed(3)} <= ${preStep.toFixed(3)}`);
  // Stadig mindst 6 dB over verset 5 s inde, og aldrig overstyret.
  assert.ok(first5[first5.length - 1].out > 2 * preStep, `5 s inde: ${first5[first5.length - 1].out.toFixed(3)}`);
  // Butterchurns bas er forholdet mod et løbende gennemsnit (τ ≈ 4,15 s). Det skal blive over 1 i 5 s og aldrig
  // falde meget under (den gamle AGC: under 1 efter 2,4 s og ned til 0,80).
  let longAvg = preStep;
  const ratio = after.map((f) => {
    longAvg += (f.out - longAvg) * (1 - Math.exp(-1 / FPS / 4.15));
    return { t: f.t, r: f.out / longAvg };
  });
  for (const x of ratio.filter((x) => x.t < 65)) assert.ok(x.r > 1, `forhold ${x.r.toFixed(2)} ${(x.t - 60).toFixed(2)} s inde`);
  assert.ok(Math.min(...ratio.map((x) => x.r)) > 0.85, 'forholdet faldt under 0,85');
  assert.ok(after.every((f) => f.out <= AGC_DEFAULTS.overloadRms), 'overstyret');
  // Ingen svingning under det stille niveau, og det høje glider til sidst tilbage mod målet (her begrænset af
  // minGain: -14 dB × 0,5 = 0,1).
  assert.ok(after.every((f) => f.out > preStep * 0.99), 'under versets niveau');
  const end = after[after.length - 1].out;
  const settled = fromDb(-14) * Math.max(AGC_DEFAULTS.minGain, AGC_DEFAULTS.targetRms / fromDb(-14));
  assert.ok(Math.abs(end - settled) / settled < 0.05, `efter 3 min: ${end.toFixed(4)}, forventet ${settled.toFixed(4)}`);
});

test('stille intro (-38 dB) og så bandet (-14 dB): højst 0,3 s over RMS 0,5, og bandet er stadig højest', () => {
  const agc = new Agc();
  const intro = run(agc, 0, 20, constant(-38));
  const introOut = intro[intro.length - 1].out;
  assert.ok(agc.gain > 5, `introen giver høj forstærkning (${agc.gain.toFixed(2)})`);

  const band = run(agc, 20, 60, constant(-14));
  const overSec = band.filter((f) => f.out > 0.5).length / FPS;
  assert.ok(overSec <= 0.3, `${overSec.toFixed(2)} s over RMS 0,5`);
  // Bandet kommer ikke under introens niveau i de første 10 s.
  assert.ok(band.filter((f) => f.t < 30).every((f) => f.out > introOut), 'bandet under introen');
});

test('reseed() måler 0,2 s og sætter forstærkningen direkte, uden glidning', () => {
  const agc = new Agc();
  run(agc, 0, 60, constant(-30));
  const settled = agc.gain;
  assert.ok(Math.abs(settled - AGC_DEFAULTS.targetRms / fromDb(-30)) < 0.05, `forstærkning ${settled.toFixed(3)}`);

  agc.reseed();
  assert.equal(agc.seeding, true);
  const seed = run(agc, 60, 60.25, constant(-18));
  const expected = AGC_DEFAULTS.targetRms / fromDb(-18);
  assert.equal(agc.seeding, false);
  assert.ok(Math.abs(agc.gain - expected) < 1e-6, `forstærkning ${agc.gain.toFixed(4)}, forventet ${expected.toFixed(4)}`);
  // Under målingen holdes den gamle forstærkning (ingen langsom glidning undervejs).
  const during = seed.filter((f) => f.t < 60 + AGC_DEFAULTS.seedSec - 1.5 / FPS);
  assert.ok(during.length >= 10);
  assert.ok(during.every((f) => f.gain === settled), 'forstærkningen gled under målingen');
  // Derefter er udgangen på målet med det samme.
  const next = run(agc, 60.25, 61, constant(-18));
  assert.ok(next.every((f) => Math.abs(f.out - AGC_DEFAULTS.targetRms) < 0.002), 'ikke på målet efter reseed');
});

test('musik efter stilhed med reseed: ingen overstyring, og målet nås på 0,2 s', () => {
  const agc = new Agc();
  run(agc, 0, 30, constant(-38)); // stille sang: høj forstærkning
  const frozen = run(agc, 30, 35, () => 0.0005, { silent: true });
  assert.ok(frozen.every((f) => f.gain === frozen[0].gain));
  agc.reseed(); // app.js: wake med newSong
  const loud = run(agc, 35, 45, constant(-14));
  const overSec = loud.filter((f) => f.out > 0.5).length / FPS;
  assert.ok(overSec <= 0.05, `${overSec.toFixed(2)} s over RMS 0,5`);
  const settledOut = loud.filter((f) => f.t >= 35.25).map((f) => f.out);
  // Begrænset nedad af minGain: -14 dB × 0,5 = 0,1.
  const expected = fromDb(-14) * Math.max(AGC_DEFAULTS.minGain, AGC_DEFAULTS.targetRms / fromDb(-14));
  assert.ok(settledOut.every((o) => Math.abs(o - expected) < 0.005), `efter målingen ${settledOut[0].toFixed(3)}, forventet ${expected.toFixed(3)}`);
});

test('fryser i stilhed og under støjgulvet, og en reseed venter på lyd', () => {
  const agc = new Agc();
  run(agc, 0, 30, constant(-24));
  const gain = agc.gain;
  // Musikmotoren melder stilhed: selv tydelig lyd rører ikke forstærkningen.
  run(agc, 30, 60, constant(-30), { silent: true });
  assert.equal(agc.gain, gain);
  // Under støjgulvet (RMS 0,0015) uden stilhedsflag: heller ikke.
  run(agc, 60, 90, () => 0.001);
  assert.equal(agc.gain, gain);

  agc.reseed();
  run(agc, 90, 100, () => 0.0005, { silent: true });
  assert.equal(agc.seeding, true, 'målingen må ikke bruge stilheden');
  assert.equal(agc.gain, gain);
  run(agc, 100, 100.3, constant(-30));
  assert.equal(agc.seeding, false);
  assert.ok(Math.abs(agc.gain - AGC_DEFAULTS.targetRms / fromDb(-30)) < 1e-6);
});

test('forstærkningen holder sig mellem 0,5 og 12', () => {
  const quiet = new Agc();
  run(quiet, 0, 120, constant(-50));
  assert.equal(quiet.gain, AGC_DEFAULTS.maxGain);
  const loud = new Agc();
  run(loud, 0, 120, constant(-3));
  assert.equal(loud.gain, AGC_DEFAULTS.minGain);
});
