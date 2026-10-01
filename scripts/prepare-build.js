'use strict';

/*
 * Forbereder installationsfilen (npm run dist): tegner app-ikonet som .ico ud fra src/main/icon.js
 * og samler licenserne for de biblioteker, der følger med, i THIRD_PARTY_NOTICES.txt.
 * Output lægges i build/ (ignoreres af git).
 */
const fs = require('node:fs');
const path = require('node:path');
const { iconPng } = require('../src/main/icon');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

/** ICO med PNG-billeder i flere størrelser (understøttet siden Windows Vista). */
function buildIco(sizes) {
  const images = sizes.map((size) => ({ size, data: iconPng(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserveret
  header.writeUInt16LE(1, 2); // type: ikon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 betyder 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // ingen palet
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // farveplaner
    entry.writeUInt16LE(32, 6); // bit pr. pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(outDir, 'icon.png'), iconPng(512));

const notices = [
  ['Butterchurn (MilkDrop 2 in WebGL)', 'node_modules/butterchurn/LICENSE'],
  ['butterchurn-presets (MilkDrop presets)', 'node_modules/butterchurn-presets/LICENSE'],
  ['VT323 font (via @fontsource/vt323)', 'node_modules/@fontsource/vt323/LICENSE'],
  ['electron-updater (automatic updates)', 'node_modules/electron-updater/LICENSE'],
  ['Electron', 'node_modules/electron/LICENSE'],
];
const parts = [
  'The Grid includes the following third-party software.',
  'Chromium and its components are listed in LICENSES.chromium.html next to The Grid.exe.',
  '',
];
for (const [name, file] of notices) {
  parts.push('='.repeat(78), name, '='.repeat(78), fs.readFileSync(path.join(root, file), 'utf8').trim(), '');
}
fs.writeFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES.txt'), parts.join('\r\n').replace(/\r?\n/g, '\r\n'));

// Opdateringerne: appen (src/main/update-config.js) og electron-builder (build.publish) skal pege samme sted hen.
const publish = require(path.join(root, 'package.json')).build.publish;
const appConfig = require('../src/main/update-config');
for (const key of Object.keys(appConfig)) {
  if (publish[key] !== appConfig[key]) {
    throw new Error(`build.publish.${key} (${publish[key]}) does not match src/main/update-config.js (${appConfig[key]})`);
  }
}
// Mappen, som en læse-token til et privat releases-repo kopieres fra (scripts/release.js lægger den der).
fs.mkdirSync(path.join(outDir, 'update-token'), { recursive: true });

console.log(`Build files written to ${outDir}`);
