'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../src/shared/i18n');
const GridFont = require('../src/shared/grid-font');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('alle tekster er ikke-tomme strenge på engelsk', () => {
  for (const [key, text] of Object.entries(i18n.STRINGS)) {
    assert.equal(typeof text, 'string', key);
    assert.ok(text.trim(), `${key} er tom`);
    assert.doesNotMatch(text, /[æøåÆØÅ]/, `${key} indeholder dansk`);
  }
});

test('alle nøgler i index.html findes', () => {
  const html = read('src/renderer/index.html');
  const keys = [...html.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of keys) assert.ok(i18n.has(key), `index.html bruger ukendt nøgle ${key}`);
});

test('alle faste nøgler i app.js findes', () => {
  const source = read('src/renderer/app.js');
  const keys = [...source.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of keys) assert.ok(i18n.has(key), `app.js bruger ukendt nøgle ${key}`);
  // Påskeæg slås op som egg.<navn>.
  for (const name of ['jazz', 'users', 'greetings', 'encom', 'zen']) assert.ok(i18n.has(`egg.${name}`));
});

test('fejlkoder fra hovedprocessen har en oversættelse', () => {
  const codes = new Set();
  for (const file of ['src/main/spotify-api.js', 'src/main/spotify-auth.js', 'src/main/main.js', 'src/main/playback.js']) {
    for (const m of read(file).matchAll(/new SpotifyError\(\s*'([A-Z_]+)'/g)) codes.add(m[1]);
  }
  assert.ok(codes.size > 5);
  for (const code of codes) assert.ok(i18n.has(`err.${code}`), `err.${code} mangler`);
});

test('pladsholdere udfyldes, og ukendte nøgler giver reserven', () => {
  assert.equal(i18n.t('lcd.part', { n: 3 }), 'SECTOR 3');
  assert.equal(i18n.t('findes.ikke', null, 'reserve'), 'reserve');
});

test('lyscykel-skriften har alle bogstaver introen og påskeæggene bruger', () => {
  const texts = ['WELCOME', 'TO THE GRID', 'FLYNN LIVES', 'END OF LINE.', 'GREETINGS PROGRAM!'];
  for (const text of texts) {
    for (const ch of text.replace(/ /g, '')) assert.ok(GridFont.GLYPHS[ch], `mangler bogstavet ${ch}`);
  }
  // Kun vandrette og lodrette streger: cyklerne kan kun dreje 90 grader.
  for (const [ch, [, strokes]] of Object.entries(GridFont.GLYPHS)) {
    for (const points of strokes) {
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        assert.ok(x0 === x1 || y0 === y1, `${ch} har en skrå streg`);
      }
    }
  }
  const layout = GridFont.layout(['WELCOME', 'TO THE GRID']);
  assert.equal(layout.letters, 16);
  const xs = layout.strokes.flatMap((s) => s.points.map((p) => p[0]));
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 0.01, 'teksten er centreret');
});

test('Drew-showets linjer findes, i nummerorden, uden den fjernede hilsen', () => {
  const lines = i18n.numbered('drew.line');
  assert.ok(lines.length >= 10, `${lines.length} linjer`);
  assert.equal(lines[0], 'WELCOME TO DREWTOPIA');
  assert.ok(lines.includes('PLEASE STOP HITTING THE SCREEN, DREW'));
  assert.ok(!lines.includes('GREETINGS, DREWBRAHAM'), 'hilsenen er fjernet');
  assert.deepEqual(i18n.numbered('findes.ikke'), []);
});
