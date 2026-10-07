#!/usr/bin/env node
/*
 * Bygger dinosaur-pakken (src/renderer/presets/dino-pack.js) til Jurassic Grid (kommandoen "dino"):
 * - bregnen (Flexi - oldschool tree) med en T. rex som frø (scripts/lib/dino-presets.js, dinoFern)
 * - de presets, Peter har beholdt i review-vinduet (data/dino/keep.txt: "<preset> [<art>]"), med klat-til-dinosaur-
 *   bølgen i de frie wave-pladser. Særlige indstillinger pr. preset i data/dino/options.json.
 * Silhuetterne (data/dino/<art>.json) er PhyloPic, CC0 (data/dino/credits.json).
 *
 *   node scripts/build-dino-pack.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withDino, dinoFern } = require('./lib/dino-presets');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data', 'dino');
const presetsDir = path.join(root, 'src', 'renderer', 'presets');

function loadPack(file, globalName) {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(presetsDir, file), 'utf8'), { window: win });
  return win[globalName].getPresets();
}

const packs = { ...loadPack('winamp-classics.js', 'gridPresetsWinampClassics'), ...loadPack('cream-of-the-crop.js', 'gridPresetsCreamOfTheCrop') };
const species = {};
for (const file of fs.readdirSync(dataDir)) {
  if (file.endsWith('.json') && !['credits.json', 'options.json'].includes(file)) species[file.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
}
const options = fs.existsSync(path.join(dataDir, 'options.json')) ? JSON.parse(fs.readFileSync(path.join(dataDir, 'options.json'), 'utf8')) : {};
const credits = JSON.parse(fs.readFileSync(path.join(dataDir, 'credits.json'), 'utf8'));

const out = {};
const FERN = 'Flexi - oldschool tree';
if (packs[FERN]) out[`${FERN} [dino fern]`] = dinoFern(packs[FERN], species.trex);
else console.warn('missing:', FERN);

const keep = fs.readFileSync(path.join(dataDir, 'keep.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
for (const line of keep) {
  const m = /^(.*) \[([a-z]+)\]$/.exec(line);
  if (!m) { console.warn('cannot parse keep line:', line); continue; }
  const [, name, sp] = m;
  if (!packs[name]) { console.warn('missing preset:', name); continue; }
  if (!species[sp]) { console.warn('missing species:', sp); continue; }
  const p = withDino(packs[name], species[sp], options[name] || {});
  if (!p) { console.warn('no free wave slot:', name); continue; }
  out[line] = p;
}

const file = path.join(presetsDir, 'dino-pack.js');
fs.writeFileSync(
  file,
  '/* Jurassic Grid: presets med dinosaurer (kommandoen "dino"). Genereret af scripts/build-dino-pack.js ud fra data/dino;\n' +
    ' * redigér ikke i hånden. Silhuetter: PhyloPic, CC0 (data/dino/credits.json). */\n' +
    'window.gridPresetsDino = { getPresets: function () { return ' +
    JSON.stringify(out) +
    '; }, credits: ' +
    JSON.stringify(credits) +
    ' };\n'
);
console.log(`${Object.keys(out).length} dinosaur presets -> ${path.relative(root, file)} (${Math.round(fs.statSync(file).size / 1024)} kB)`);
