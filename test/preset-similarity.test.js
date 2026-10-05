'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { similarity, affinity } = require('../src/shared/preset-similarity.js');

test('lighed: ens er 1, modsat er 0', () => {
  assert.equal(similarity([0.2, 0.8], [0.2, 0.8]), 1);
  assert.equal(similarity([0, 1], [1, 0]), 0);
});

test('smag: et preset som favoritterne scorer højere end et som de afviste', () => {
  const likes = [[0.9, 0.9, 0.1], [0.8, 0.95, 0.2]];
  const dislikes = [[0.1, 0.1, 0.9], [0.2, 0.05, 0.8]];
  assert.ok(affinity([0.85, 0.9, 0.15], likes, dislikes) > 0.5);
  assert.ok(affinity([0.15, 0.1, 0.85], likes, dislikes) < 0);
  assert.equal(affinity([0.5, 0.5, 0.5], [], dislikes), 0, 'uden favoritter: ingen mening');
});
