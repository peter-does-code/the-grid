'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FramePacer, FrameStats, divisorFor, estimateRefresh } = require('../src/shared/frame-pacer.js');

/** Kører takten i `seconds` på en skærm med `hz`; `skip(i)` kan tabe et billede (rAF kommer en periode senere). */
function run(pacer, hz, seconds, { t0 = 0, jitter = 0, skip = () => false } = {}) {
  const period = 1000 / hz;
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  const rendered = [];
  let vsync = 0;
  for (let i = 0; vsync * period < seconds * 1000; i++) {
    vsync += skip(i) ? 2 : 1;
    const ts = t0 + vsync * period + jitter * rnd();
    if (pacer.tick(ts)) rendered.push(ts);
  }
  return rendered;
}

/** Billeder i sekundet efter opvarmningen (fra 2 s). */
function fpsAfterWarmup(rendered, t0 = 0) {
  const late = rendered.filter((ts) => ts >= t0 + 2000);
  return (late.length - 1) / ((late[late.length - 1] - late[0]) / 1000);
}

test('deleren giver højst 72 fps og så tæt på 60 som muligt', () => {
  const cases = { 50: 1, 59.94: 1, 60: 1, 72: 1, 75: 2, 90: 2, 100: 2, 120: 2, 144: 2, 165: 3, 240: 4, 360: 5 };
  for (const [hz, n] of Object.entries(cases)) assert.equal(divisorFor(Number(hz)), n, `${hz} Hz`);
  assert.equal(divisorFor(144.6), 2, 'rystende tidsstempler på 144 Hz');
  assert.equal(divisorFor(null), 1);
});

test('opdateringsraten estimeres, også når hvert femte billede tabes', () => {
  const intervals = [];
  for (let i = 0; i < 200; i++) intervals.push(i % 5 === 0 ? 2000 / 144 : 1000 / 144);
  assert.ok(Math.abs(estimateRefresh(intervals) - 144) < 0.5);
  assert.equal(estimateRefresh([16.7, 16.6]), null, 'for få målinger');
});

test('60 Hz tegner hvert billede, 120 og 144 Hz hvert andet, 165 Hz hvert tredje', () => {
  for (const [hz, want] of [[60, 60], [120, 60], [144, 72], [165, 55], [240, 60]]) {
    const pacer = new FramePacer();
    const fps = fpsAfterWarmup(run(pacer, hz, 6, { jitter: 0.6 }));
    assert.ok(Math.abs(fps - want) < 1.5, `${hz} Hz: ${fps.toFixed(1)} fps`);
    assert.ok(Math.abs(pacer.refreshHz - hz) < hz * 0.02, `${hz} Hz estimeret som ${pacer.refreshHz.toFixed(1)}`);
  }
});

test('også det første sekund (før estimatet) holder sig under loftet', () => {
  const pacer = new FramePacer();
  const first = run(pacer, 144, 1).length;
  assert.ok(first <= 75, `${first} billeder det første sekund`);
});

test('tabte billeder: takten tæller skærmopdateringer, ikke rAF-kald', () => {
  const pacer = new FramePacer();
  // 120 Hz, hvert syvende rAF kommer en periode for sent: stadig ca. 60 fps, ikke færre.
  const fps = fpsAfterWarmup(run(pacer, 120, 6, { skip: (i) => i % 7 === 3 }));
  assert.ok(fps > 55 && fps <= 61, `${fps.toFixed(1)} fps`);
});

test('efter en pause tegnes med det samme, og pausen er ikke en billedtid', () => {
  const pacer = new FramePacer();
  run(pacer, 60, 2);
  pacer.resetStats();
  pacer.resume();
  const rendered = run(pacer, 60, 2, { t0: 10000 });
  assert.equal(rendered[0], 10000 + 1000 / 60, 'første billede efter pausen');
  assert.ok(pacer.frameStats.summary().max < 20, 'ingen lang billedtid fra pausen');
  assert.equal(pacer.divisor, 1);
});

test('FrameStats: median, 95-percentil og hak over 20 ms', () => {
  const stats = new FrameStats(100);
  for (let i = 0; i < 95; i++) stats.add(16.7);
  for (let i = 0; i < 5; i++) stats.add(33.4);
  const s = stats.summary();
  assert.equal(s.count, 100);
  assert.equal(s.p50, 16.7);
  assert.equal(s.over20, 5);
  assert.equal(s.max, 33.4);
  // Ringbufferen husker kun de seneste 100.
  for (let i = 0; i < 100; i++) stats.add(10);
  assert.equal(stats.summary().over20, 0);
  assert.equal(stats.summary().count, 200);
  stats.reset();
  assert.equal(stats.summary().p50, null);
});
