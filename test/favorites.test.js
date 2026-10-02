'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('../src/renderer/visualizer.js');
const { Visualizer } = global.window.Visamp;

/** En visualizer uden Butterchurn: kun listerne og valget. */
function fake(names, history = []) {
  const v = Object.create(Visualizer.prototype);
  v.names = names.slice();
  v.allNames = names.slice();
  v.presets = Object.fromEntries(names.map((n) => [n, {}]));
  v.history = history.slice();
  v.failed = new Set();
  v.profiles = new Map(names.map((n) => [n, {}]));
  return v;
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function wins(v, name, other, rounds = 2000) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < rounds; i++) {
    const pick = v.pickSmart(() => 1, rnd); // alle presets scorer ens; kun favorit-tillægget skiller
    if (pick === name) a += 1;
    if (pick === other) b += 1;
  }
  return [a, b];
}

test('under 20 favoritter vægtes de ikke: en favorit vinder ikke oftere end andre', () => {
  const names = Array.from({ length: 40 }, (_, i) => `p${i}`);
  const v = fake(names);
  v.setFavorites(['p7', 'p9', 'p11']);
  assert.equal(v.favoritesWeighted(), false);
  const [fav, other] = wins(v, 'p7', 'p8');
  assert.ok(Math.abs(fav - other) < 120, `favorit ${fav}, andet ${other}`);
});

test('fra 20 favoritter vinder de oftere i det musikstyrede valg', () => {
  const names = Array.from({ length: 60 }, (_, i) => `p${i}`);
  const v = fake(names);
  v.setFavorites(names.slice(0, 20));
  assert.equal(v.favoritesWeighted(), true);
  const [fav, other] = wins(v, 'p7', 'p40');
  assert.ok(fav > 5 * Math.max(1, other), `favorit ${fav}, andet ${other}`);
});

test('når de vægtes, må en favorit komme igen efter 40 skift, andre først efter 150', () => {
  const names = Array.from({ length: 400 }, (_, i) => `p${i}`);
  const history = ['fav', 'other', ...Array.from({ length: 50 }, (_, i) => `p${i}`)];
  const v = fake([...names, 'fav', 'other'], history);
  v.setFavorites(['fav', ...Array.from({ length: 19 }, (_, i) => `p${300 + i}`)]);
  const isRecent = v.recentSets();
  assert.equal(isRecent('fav'), false, 'favoritten er fri efter 50 skift');
  assert.equal(isRecent('other'), true, 'andre venter stadig');
  v.setFavorites(['fav']); // under 20: som alle andre
  assert.equal(v.recentSets()('fav'), true);
});
