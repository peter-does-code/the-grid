'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Et falsk 2D-lærred: alle tegnekald accepteres, gradienter har addColorStop.
function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

global.window = { devicePixelRatio: 1 };
let frames = [];
global.requestAnimationFrame = (fn) => frames.push(fn);
require('../src/renderer/tron-overlay.js');
const { TronOverlay } = global.window.Visamp;

function makeOverlay() {
  const canvas = { width: 0, height: 0, hidden: true, getContext: () => fakeContext(), getBoundingClientRect: () => ({ width: 1280, height: 720 }) };
  return { canvas, overlay: new TronOverlay(canvas) };
}

/** Kører sløjfen i `seconds` med 60 billeder i sekundet. */
function runFrames(seconds, t0 = 0) {
  let t = t0;
  for (let i = 0; i < seconds * 60; i++) {
    t += 1000 / 60;
    const pending = frames;
    frames = [];
    for (const fn of pending) fn(t);
  }
  return t;
}

test('Tron-laget tegner gulv, slag, lyscykler, ny del og derez uden fejl', () => {
  frames = [];
  const { canvas, overlay } = makeOverlay();
  overlay.setEnabled(true);
  assert.equal(canvas.hidden, false);
  let t = runFrames(1);
  assert.ok(overlay.visibility > 0.9, 'toner ind');
  overlay.beat({ downbeat: true, bpm: 128 });
  assert.equal(overlay.bpm, 128);
  assert.ok(overlay.pulse >= 1);
  overlay.event('drop');
  assert.ok(overlay.cycles.length >= 3, 'lyscykler på droppet');
  overlay.event('section');
  overlay.event('cut');
  t = runFrames(0.5, t);
  assert.ok(overlay.derez === 0, 'derez-glimtet er kort');
  assert.ok(overlay.cycles.some((c) => c.trail.length > 10), 'lyscyklerne kører og trækker en lysvæg');
  t = runFrames(6, t);
  assert.equal(overlay.cycles.length, 0, 'lyscyklerne er væk igen');
});

test('slået fra toner laget ud og skjules, og hændelser ignoreres', () => {
  frames = [];
  const { canvas, overlay } = makeOverlay();
  overlay.setEnabled(true);
  let t = runFrames(1);
  overlay.setEnabled(false);
  t = runFrames(3, t);
  assert.equal(canvas.hidden, true);
  assert.equal(frames.length, 0, 'sløjfen er stoppet');
  overlay.event('drop');
  assert.equal(overlay.cycles.length, 0);
});
