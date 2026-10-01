'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FlashGuard } = require('../src/shared/flash-guard.js');

/** Kører vagten i `seconds` med 30 målinger i sekundet; `luma(t)` giver lysstyrken. Returnerer tidspunkterne, den slog til. */
function run(guard, seconds, luma, t0 = 0) {
  const trips = [];
  for (let i = 0; i < seconds * 30; i++) {
    const t = t0 + i / 30;
    if (guard.feed(t, luma(t))) trips.push(t);
  }
  return trips;
}

const strobe = (t) => (Math.floor(t * 30) % 2 ? 0.9 : 0.1); // tænd og sluk hvert billede
const onBeat = (bpm) => (t) => ((t * bpm) / 60) % 1 < 0.08 ? 0.95 : 0.2; // et blink pr. slag
const calm = (t) => 0.3 + 0.05 * Math.sin(t);

test('konstant stroboskop: vagten slår til efter ca. 8 s (to vinduer), ikke før', () => {
  const guard = new FlashGuard();
  guard.notifyChange(0);
  const trips = run(guard, 20, strobe);
  assert.ok(trips.length >= 1, 'slog til');
  assert.ok(trips[0] >= 6 + 8 - 0.1 && trips[0] < 6 + 8 + 1, `slog til efter ${trips[0].toFixed(1)} s`);
});

test('blink på slaget (op til 180 BPM) og rolige billeder får lov at blive', () => {
  for (const bpm of [90, 128, 180]) {
    const guard = new FlashGuard();
    guard.notifyChange(0);
    assert.equal(run(guard, 60, onBeat(bpm)).length, 0, `${bpm} BPM`);
  }
  const guard = new FlashGuard();
  guard.notifyChange(0);
  assert.equal(run(guard, 60, calm).length, 0);
});

test('ikke under overgangen, og højst ét skift pr. 30 s', () => {
  const guard = new FlashGuard();
  guard.notifyChange(0);
  // Strobe hele vejen: første skift efter ca. 14 s, så skal der gå mindst 30 s til det næste.
  const trips = run(guard, 70, strobe);
  assert.ok(trips.length >= 2);
  assert.ok(trips[1] - trips[0] >= 30, `${(trips[1] - trips[0]).toFixed(1)} s imellem`);
  // Efter et skift tæller de første 6 s ikke, heller ikke hvis det nye preset blinker.
  const fresh = new FlashGuard();
  fresh.notifyChange(100);
  assert.equal(run(fresh, 6, strobe, 100).length, 0);
});
