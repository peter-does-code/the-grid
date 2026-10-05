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

/** Kører `rounds` skift, hvor hvert valg kommer i historikken, og tæller favoritterne. */
function favoriteShare(v, score, rounds = 400) {
  let favs = 0;
  for (let i = 0; i < rounds; i++) {
    const pick = v.pickSmart(score, rnd);
    v.history.push(pick);
    if (v.isFavorite(pick)) favs += 1;
  }
  return favs / rounds;
}

test('loft: selv med mange favoritter og stort tillæg får de højst ca. hvert 5. skift', () => {
  const names = Array.from({ length: 800 }, (_, i) => `p${i}`);
  const v = fake(names);
  v.setFavorites(names.slice(0, 50));
  const share = favoriteShare(v, () => 1);
  assert.ok(share <= 0.21, `favoritandel ${share}`);
  assert.ok(share >= 0.1, `favoritterne vægtes stadig: ${share}`);
});

test('loftet gælder ikke, før favoritterne vægtes', () => {
  const names = Array.from({ length: 40 }, (_, i) => `p${i}`);
  const v = fake(names, ['p1', 'p2', 'p3', 'p4', 'p5']);
  v.setFavorites(['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(v.favoritesCapped(), false);
  v.setFavorites(names.slice(0, 20));
  assert.equal(v.favoritesCapped(), true);
  assert.equal(v.recentSets()('p10'), true, 'alle favoritter venter, når loftet er nået');
});

test('en del af de musikstyrede skift er helt tilfældige', () => {
  const names = Array.from({ length: 400 }, (_, i) => `p${i}`);
  const v = fake(names);
  // Scoren foretrækker p0-p19 kraftigt, så resten kun kan komme med ved et tilfældigt skift.
  const scores = new Map(names.map((n, i) => [v.profile(n), i < 20 ? 10 : 0]));
  let outside = 0;
  const rounds = 2000;
  for (let i = 0; i < rounds; i++) {
    const pick = v.pickSmart((p) => scores.get(p), rnd);
    if (Number(pick.slice(1)) >= 20) outside += 1;
  }
  assert.ok(outside / rounds > 0.12 && outside / rounds < 0.28, `udenfor de bedste: ${outside / rounds}`);
});

test("Peters valg: lægges oven i brugerens egne, men brugerens K og D og fortrydelser vinder", () => {
  const { presetLists } = global.window.Visamp;
  const peter = { favorites: ['a', 'b', 'c'], derez: ['x', 'y', 'z'] };
  const l = presetLists({ favorites: ['own', 'x'], hidden: ['b', 'mine'], exceptions: ['c', 'z'], peter });
  assert.deepEqual([...l.favorites].sort(), ['a', 'own', 'x']);
  assert.deepEqual([...l.hidden].sort(), ['b', 'mine', 'y']);
  assert.deepEqual([...l.peterFav], ['a']);
  assert.deepEqual([...l.peterHidden], ['y']);
  const off = presetLists({ favorites: ['own'], hidden: ['mine'], peter: null });
  assert.deepEqual([...off.favorites], ['own']);
  assert.deepEqual([...off.hidden], ['mine']);
});

test('Classic Winamp mode: kun de klassiske navne (store/små bogstaver ligegyldige), skjulte stadig væk', () => {
  const v = fake(['Geiss - A', 'Rovastar - B', 'New - C', 'New - D']);
  v.setHidden(['Rovastar - B']);
  v.setOnly(['geiss - a', 'rovastar - b']);
  assert.deepEqual(v.names, ['Geiss - A']);
  v.setOnly(['findes ikke']);
  assert.deepEqual(v.names, ['Geiss - A', 'New - C', 'New - D'], 'ingen klassikere: alle, så der er noget at vise');
  v.setOnly(null);
  assert.deepEqual(v.names, ['Geiss - A', 'New - C', 'New - D']);
});
