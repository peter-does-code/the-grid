'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BD = require('../src/shared/band-drive');

const FPS = 60;
const DT = 1 / FPS;

/** Kører en RunningRatio i `seconds` med værdien fra value(t). Returnerer det sidste forhold. */
function runRatio(norm, seconds, value, t0 = 0, frozen = false) {
  let r = 0;
  for (let i = 1; i <= Math.round(seconds * FPS); i++) r = norm.update(value(t0 + i * DT), DT, frozen);
  return r;
}

test('et konstant signal normaliseres til 1,0', () => {
  const norm = new BD.RunningRatio();
  assert.equal(norm.update(0.37, DT), 1);
  for (const seconds of [1, 10, 40]) {
    const r = runRatio(norm, seconds, () => 0.37);
    assert.ok(Math.abs(r - 1) < 1e-9, `${seconds} s: ${r}`);
  }
});

test('et spring op giver over 1, der glider tilbage mod 1 over 10-20 s', () => {
  const norm = new BD.RunningRatio({ tauSec: 15 });
  runRatio(norm, 30, () => 1);
  const first = norm.update(2, DT);
  assert.ok(first > 1.9 && first <= 2, `lige efter springet: ${first}`);
  const after5 = runRatio(norm, 5, () => 2);
  assert.ok(after5 > 1.4 && after5 < first, `efter 5 s: ${after5}`);
  const after30 = runRatio(norm, 25, () => 2);
  assert.ok(after30 < 1.2, `efter 30 s: ${after30}`);
  // Et spring ned giver under 1.
  assert.ok(norm.update(0.5, DT) < 0.5);
});

test('forholdet klemmes, og stilhed flytter ikke gennemsnittet', () => {
  const norm = new BD.RunningRatio({ max: 3 });
  runRatio(norm, 20, () => 1);
  assert.equal(norm.update(50, DT), 3);
  runRatio(norm, 1, () => 1);
  // Ti sekunders stilhed (motoren melder stilhed): gennemsnittet står stille.
  const quiet = runRatio(norm, 10, () => 0.001, 0, true);
  assert.ok(quiet < 0.01);
  const back = norm.update(1, DT);
  assert.ok(Math.abs(back - 1) < 0.15, `efter pausen: ${back}`);
});

test('et stille intro låser ikke forholdet på loftet (gennemsnit af alt hørt, indtil tau er gået)', () => {
  const norm = new BD.RunningRatio({ tauSec: 15 });
  runRatio(norm, 1, () => 0.1);
  const r = runRatio(norm, 4, () => 1);
  assert.ok(r < 1.5, `5 s inde: ${r}`);
});

test('kuverterne falder med de angivne tider', () => {
  const d = BD.BAND_DRIVE_DEFAULTS;
  // De tider, sporet i research-dokumentet angiver.
  assert.ok(d.kick.release >= 0.15 && d.kick.release <= 0.25);
  assert.ok(d.kick.attack <= 0.02);
  assert.ok(d.mid.attack >= 0.1 && d.mid.release <= 0.3);
  assert.ok(d.treb.release >= 0.05 && d.treb.release <= 0.08);
  assert.ok(d.glintRelease >= 0.05 && d.glintRelease <= 0.08);
  assert.ok(d.normTauSec >= 10 && d.normTauSec <= 20);
  for (const [name, o] of [['kick', d.kick], ['mid', d.mid], ['treb', d.treb]]) {
    const env = new BD.Envelope(o);
    // Op: efter `attack` sekunder er 63 % af vejen gået.
    const up = Math.round(o.attack * 1000);
    for (let i = 0; i < up; i++) env.update(1, 0.001);
    assert.ok(Math.abs(env.value - (1 - Math.exp(-1))) < 0.02, `${name} attack: ${env.value}`);
    for (let i = 0; i < 2000; i++) env.update(1, 0.001);
    // Ned: efter `release` sekunder er 37 % tilbage, efter 5 × release under 1 %.
    const down = Math.round(o.release * 1000);
    for (let i = 0; i < down; i++) env.update(0, 0.001);
    assert.ok(Math.abs(env.value - Math.exp(-1)) < 0.02, `${name} release: ${env.value}`);
    for (let i = 0; i < 4 * down; i++) env.update(0, 0.001);
    assert.ok(env.value < 0.01, `${name} efter 5 × release: ${env.value}`);
  }
  // Et slag springer op med det samme og falder med sin release.
  const glint = new BD.Envelope({ attack: 0, release: d.glintRelease });
  glint.hit(1);
  assert.equal(glint.value, 1);
  for (let i = 0; i < Math.round(d.glintRelease * 1000); i++) glint.update(0, 0.001);
  assert.ok(Math.abs(glint.value - Math.exp(-1)) < 0.02);
});

test('onset-porten fyrer én gang pr. slag: hysterese og mindste afstand', () => {
  const gate = new BD.OnsetGate({ on: 2.5, off: 1.4, refractory: 0.12 });
  const fired = [];
  const feed = (t, v) => gate.update(v, t) && fired.push(t);
  // Et slag, der bliver over tærsklen i flere billeder, tæller én gang.
  [3, 4, 3.5, 2.6].forEach((v, i) => feed(i * DT, v));
  assert.equal(fired.length, 1);
  // Falder det kun til 2 (over `off`), er porten ikke spændt igen.
  feed(0.2, 2);
  feed(0.22, 3);
  assert.equal(fired.length, 1);
  // Under `off` og efter den mindste afstand: et nyt slag.
  feed(0.3, 0.5);
  feed(0.32, 3);
  assert.equal(fired.length, 2);
  // For tæt på det forrige: ignoreres.
  feed(0.34, 0.5);
  feed(0.36, 3);
  assert.equal(fired.length, 2);
});

/** Lydtræk som FeatureExtractor: kick ved 120 BPM (henfald 60 ms), konstant mellemtone, hi-hats på ottendedele. */
function song(t, { kick = true, hats = true, midLevel = 1 } = {}) {
  const beat = 0.5;
  const sinceKick = t % beat;
  const sinceHat = t % (beat / 2);
  const kickAmp = kick ? 0.02 + Math.exp(-sinceKick / 0.06) : 0.02;
  const trebAmp = 0.01 + (hats ? 0.3 * Math.exp(-sinceHat / 0.02) : 0);
  return {
    f: { kick: kickAmp * kickAmp, mid: 0.04 * midLevel * midLevel, treb: trebAmp * trebAmp, trebFlux: hats && sinceHat < DT ? 4 : 0.05 },
    kickOnset: kick && sinceKick < DT ? 6 : 0.3,
  };
}

function runDrive(drive, seconds, opts = {}, t0 = 0, silent = false) {
  const out = [];
  for (let i = 1; i <= Math.round(seconds * FPS); i++) {
    const t = t0 + i * DT;
    const { f, kickOnset } = song(t, opts);
    out.push({ t, ...drive.update(t, f, { silent, kickOnset }) });
  }
  return out;
}

test('bånd-drevet: kick-båndet og rigtige kicks driver gulv og horisont, mellemtonen ligger på 0,5', () => {
  const drive = new BD.BandDrive();
  const frames = runDrive(drive, 20);
  const last4 = frames.filter((f) => f.t > 16);
  const kicks = last4.filter((f) => f.kickHit).length;
  assert.equal(kicks, 8, '120 BPM i 4 s');
  assert.ok(last4[last4.length - 1].realKicks);
  // Gulvet lyser på kicket og falder imellem.
  const peak = Math.max(...last4.map((f) => f.kick));
  const trough = Math.min(...last4.map((f) => f.kick));
  assert.ok(peak > 0.8, `top ${peak}`);
  assert.ok(trough < 0.35, `bund ${trough}`);
  // Horisonten: én release efter et kick er ca. 37 % tilbage.
  const release = BD.BAND_DRIVE_DEFAULTS.horizonRelease;
  assert.ok(release >= 0.15 && release <= 0.25);
  const hit = last4.find((f) => f.kickHit);
  const later = last4.find((f) => f.t >= hit.t + release - 1e-9);
  const expected = Math.exp(-(later.t - hit.t) / release);
  assert.ok(Math.abs(later.horizon / hit.horizon - expected) < 0.01, `${later.horizon} / ${hit.horizon}`);
  assert.ok(Math.abs(expected - Math.exp(-1)) < 0.05);
  // Konstant mellemtone er "normal".
  assert.ok(Math.abs(last4[last4.length - 1].mid - 0.5) < 0.02);
  // Hi-hats: glimt på hver ottendedel, og de er væk igen på under 0,2 s.
  assert.equal(last4.filter((f) => f.hatHit).length, 16);
  const hat = last4.find((f) => f.hatHit);
  assert.ok(last4.find((f) => f.t >= hat.t + 0.2 - 1e-9).glint < 0.06);
});

test('mere mellemtone end normalt giver mere end 0,5, mindre giver mindre', () => {
  const drive = new BD.BandDrive();
  runDrive(drive, 20);
  const loud = runDrive(drive, 0.6, { midLevel: 2 }, 20);
  assert.ok(loud[loud.length - 1].mid > 0.85, `${loud[loud.length - 1].mid}`);
  const quiet = runDrive(drive, 0.8, { midLevel: 0.4 }, 20.6);
  assert.ok(quiet[quiet.length - 1].mid < 0.25, `${quiet[quiet.length - 1].mid}`);
});

test('uden kicks og i stilhed: ingen slag, og niveauerne falder til hvile', () => {
  const drive = new BD.BandDrive();
  const noKick = runDrive(drive, 6, { kick: false, hats: false });
  assert.equal(noKick.filter((f) => f.kickHit).length, 0);
  assert.equal(noKick[noKick.length - 1].realKicks, false);
  runDrive(drive, 6, {}, 6);
  const silent = runDrive(drive, 1, {}, 12, true);
  const end = silent[silent.length - 1];
  assert.equal(silent.filter((f) => f.kickHit || f.hatHit).length, 0);
  assert.ok(end.kick < 0.01 && end.treb < 0.01 && end.glint < 0.01 && end.horizon < 0.01);
  assert.ok(Math.abs(end.mid - 0.5) < 0.01);
});

test('manglende lydtræk er en fejl, ikke en stille nul', () => {
  const drive = new BD.BandDrive();
  assert.throws(() => drive.update(0, { kick: 1, mid: 1, treb: 1 }), /trebFlux/);
  assert.throws(() => drive.update(0, { kick: 1, mid: 1, treb: 1, trebFlux: 0 }, { kickOnset: NaN }), /kickOnset/);
});

test('intensitet og mætning følger sangens del og stiger gennem en opbygning', () => {
  const low = BD.sectionTarget({ energy: 'low', building: false }, 0);
  const mid = BD.sectionTarget({ energy: 'mid', building: false }, 0);
  const high = BD.sectionTarget({ energy: 'high', building: false }, 0);
  assert.ok(low.intensity < mid.intensity && mid.intensity < high.intensity);
  assert.ok(low.saturation < mid.saturation && mid.saturation <= high.saturation);
  let prev = null;
  for (const t of [100, 103, 106, 109, 112]) {
    const s = BD.sectionTarget({ energy: 'mid', building: true, buildStart: 100 }, t);
    if (prev) assert.ok(s.intensity > prev.intensity && s.saturation >= prev.saturation, `t=${t}`);
    prev = s;
  }
  assert.ok(prev.intensity > high.intensity, 'toppen af en opbygning lyser mere end en høj del');
  assert.deepEqual(BD.sectionTarget({ energy: 'mid', building: true, buildStart: 100 }, 140), prev);
  assert.deepEqual(BD.saturate([0, 229, 255], 1), [0, 229, 255]);
  const grey = BD.saturate([0, 229, 255], 0);
  assert.ok(grey[0] === grey[1] && grey[1] === grey[2]);
});
