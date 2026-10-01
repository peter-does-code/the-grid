'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/shared/format.js');

test('formatTime viser m:ss og h:mm:ss', () => {
  assert.equal(F.formatTime(0), '0:00');
  assert.equal(F.formatTime(225000), '3:45');
  assert.equal(F.formatTime(3723000), '1:02:03');
  assert.equal(F.formatTime(-5), '0:00');
  assert.equal(F.formatTime(Number.NaN), '0:00');
});

test('formatClock viser Winamps mm:ss og minus ved resterende tid', () => {
  assert.equal(F.formatClock(65000), '01:05');
  assert.equal(F.formatClock(65000, true), '-01:05');
  assert.equal(F.formatClock(6000000), '100:00');
});

test('trackLabel og marqueeText', () => {
  const track = { name: 'Titel', artists: ['A', 'B'], durationMs: 185000 };
  assert.equal(F.trackLabel(track), 'A, B - Titel');
  assert.equal(F.marqueeText(track, 3), '3. A, B - Titel (3:05)');
  assert.equal(F.marqueeText({ name: 'Solo', artists: [] }), 'Solo');
  assert.equal(F.marqueeText(null), '');
});

test('marqueeFrame ruller lang tekst og lader kort tekst stå stille', () => {
  assert.equal(F.marqueeFrame('Kort', 5, 8), 'Kort    ');
  const text = 'ABCDEFGHIJ';
  assert.equal(F.marqueeFrame(text, 0, 5), 'ABCDE');
  assert.equal(F.marqueeFrame(text, 3, 5), 'DEFGH');
  assert.equal(F.marqueeFrame(text, 8, 5), 'IJ  *');
  const loopLength = `${text}  ***  `.length;
  assert.equal(F.marqueeFrame(text, loopLength, 5), 'ABCDE');
});

test('totalDuration lægger varigheder sammen og ignorerer huller', () => {
  assert.equal(F.totalDuration([{ durationMs: 1000 }, null, { durationMs: 500 }, {}]), 1500);
  assert.equal(F.totalDuration(undefined), 0);
});
