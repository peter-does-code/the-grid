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

test('favoritter vinder oftere i det musikstyrede valg', () => {
  const names = Array.from({ length: 40 }, (_, i) => `p${i}`);
  const v = fake(names);
  v.setFavorites(['p7']);
  let favWins = 0;
  let otherWins = 0;
  for (let i = 0; i < 2000; i++) {
    const pick = v.pickSmart(() => 1, rnd); // alle presets scorer ens; kun favorit-tillægget skiller
    if (pick === 'p7') favWins += 1;
    if (pick === 'p8') otherWins += 1;
  }
  assert.ok(favWins > 10 * Math.max(1, otherWins), `favorit ${favWins}, andet ${otherWins}`);
});

test('en favorit må komme igen efter 20 skift, andre først efter 150', () => {
  const names = Array.from({ length: 400 }, (_, i) => `p${i}`);
  const history = ['fav', 'other', ...Array.from({ length: 30 }, (_, i) => `p${i}`)];
  const v = fake([...names, 'fav', 'other'], history);
  v.setFavorites(['fav']);
  const isRecent = v.recentSets();
  assert.equal(isRecent('fav'), false, 'favoritten er fri efter 30 skift');
  assert.equal(isRecent('other'), true, 'andre venter stadig');
});
