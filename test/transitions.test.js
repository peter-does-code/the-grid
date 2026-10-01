'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('../src/renderer/visualizer.js');
const { Visualizer } = global.window.Visamp;
const shape = (beats, p) => Visualizer.prototype.shapeBlend.call({ activeTransition: beats ? { beats } : null }, p);

test('overgangen går i ryk på slagene: frem i starten af hvert slag, stille imellem', () => {
  // 4 slag: efter første slags første 35 % er den nået 1/4, og den står stille resten af slaget.
  assert.ok(Math.abs(shape(4, 0.25 * 0.35) - 0.25) < 1e-9);
  assert.equal(shape(4, 0.2), 0.25);
  assert.ok(shape(4, 0.3) > 0.25 && shape(4, 0.3) < 0.5, 'andet slag skubber den videre');
  assert.equal(shape(4, 0.6), 0.75);
  // Den når 1 inden Butterchurns jævne forløb, og over 1 (slut) røres værdien ikke.
  assert.equal(shape(4, 0.99), 1);
  assert.equal(shape(4, 1.02), 1.02);
});

test('uden slag (manuelt skift eller uden tempo) er forløbet uændret', () => {
  for (const p of [0, 0.1, 0.5, 0.9, 1.1]) assert.equal(shape(null, p), p);
});
