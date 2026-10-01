'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../src/shared/i18n');

global.window = global.window || {};
require('../src/renderer/eggs.js');
const { Eggs, EGG_COMMANDS, EGG_CHEAT_SHEET } = global.window.Visamp;

test('whoami åbner Flynns terminal, og ord fra Tron genkendes', () => {
  const eggs = new Eggs();
  assert.equal(eggs.command('whoami'), 'terminal');
  assert.equal(eggs.command('  WhoAmI '), 'terminal');
  assert.equal(eggs.command('who am i'), 'spaces');
  assert.equal(eggs.command('Who am I?'), 'spaces');
  assert.equal(eggs.command('Flynn lives!'), 'flynn');
  assert.equal(eggs.command('bit, will this work?'), 'bit');
  assert.equal(eggs.command('https://open.spotify.com/playlist/abc'), null);
});

test('snydearket nævner alle påskeæg, og alle tekster findes', () => {
  const listed = new Set(EGG_CHEAT_SHEET.map((row) => row[2]).filter(Boolean));
  for (const action of new Set(Object.values(EGG_COMMANDS))) {
    assert.ok(listed.has(action), `påskeægget "${action}" mangler i snydearket`);
  }
  for (const [input, key] of EGG_CHEAT_SHEET) {
    assert.ok(input.trim());
    assert.ok(i18n.has(key), `${key} mangler i i18n.js`);
  }
});

test('Konami-koden', () => {
  const eggs = new Eggs();
  const keys = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft'];
  for (const k of keys) assert.equal(eggs.key(k), null);
  assert.equal(eggs.key('ArrowRight'), 'konami'); // ↑↑↓↓←→←→, uden B og A
  assert.equal(eggs.command('battle'), 'battle');
  assert.equal(eggs.command('Game Grid'), 'battle');
});
