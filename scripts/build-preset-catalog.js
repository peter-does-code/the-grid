'use strict';

/*
 * Preset-kataloget: alt, vi ved om hvert preset i The Grid, til at kategorisere dem og på sigt forudsige, hvad en
 * bruger kan lide ud fra sine favoritter (Peter 05-10-2026).
 *
 *   node scripts/build-preset-catalog.js     (npm run presets:catalog; kør efter npm run presets:pack)
 *
 * Skriver src/renderer/presets/preset-catalog.js: window.gridPresetCatalog = { features: [navne], presets: {navn: {
 *   pack, classic, authors, style, styleGuess, tags, f }}}. `f` er en vektor (samme rækkefølge som `features`),
 * normaliseret, så presets kan sammenlignes (src/shared/preset-similarity.js).
 *
 * Kilder:
 *  - stilart: Cream of the Crops mappe (fx "Fractal/Trees"). Findes et indbygget preset eller en klassiker under
 *    samme navn i hele Cream of the Crop, bruges dens mappe. Ellers gættes stilarten ud fra de 7 mest lignende
 *    presets med kendt stilart (styleGuess; træfsikkerheden måles og skrives ud).
 *  - målinger fra preset-testen (presets-work/*.jsonl): lysstyrke, bevægelse, takt, farver, detaljer, blink.
 *  - koden: figurer, teksturerede figurer (fraktal-tricket), trekanter, bølger, ekko, shadere, og hvor tit
 *    bass, mid og treb bruges (profilePreset i music-engine.js).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const work = path.join(root, 'presets-work');
const outFile = path.join(root, 'src', 'renderer', 'presets', 'preset-catalog.js');
const COTC = process.env.COTC_DIR || path.join(work, 'cotc-src'); // hele Cream of the Crop (.milk); uden den kun de udtagne
global.window = global.window || {};
const { profilePreset } = require(path.join(root, 'src', 'shared', 'music-engine.js'));

const key = (n) => String(n).trim().toLowerCase().split(/\s+/).join(' ');
const readJsonl = (f) =>
  fs.existsSync(f)
    ? fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : [];

// --- Alle presets i appen og deres pakke ---
const presets = {};
const pack = {};
for (const p of ['butterchurnPresets', 'butterchurnPresetsExtra', 'butterchurnPresetsExtra2', 'butterchurnPresetsMD1', 'butterchurnPresetsMinimal', 'butterchurnPresetsNonMinimal']) {
  const m = require(path.join(root, 'node_modules', 'butterchurn-presets', 'lib', `${p}.min.js`));
  for (const [n, v] of Object.entries((m.default || m).getPresets())) {
    presets[n] = v;
    pack[n] = 'built-in';
  }
}
require(path.join(root, 'src', 'renderer', 'presets', 'cream-of-the-crop.js'));
require(path.join(root, 'src', 'renderer', 'presets', 'winamp-classics.js'));
const cream = window.gridPresetsCreamOfTheCrop;
const classicsPack = window.gridPresetsWinampClassics;
for (const [n, v] of Object.entries(cream.getPresets())) {
  presets[n] = v;
  pack[n] = 'cream';
}
for (const [n, v] of Object.entries(classicsPack.getPresets())) {
  presets[n] = v;
  pack[n] = 'classics';
}
const bans = new Set((cream.bans || []).map(key));
for (const n of Object.keys(presets)) if (bans.has(key(n))) delete presets[n];
// De bandlyste er ikke i appen, men med i kataloget (banned: true), så de kan bruges til at lære smagen: de findes
// som konverterede presets i presets-work.
const banned = new Set();
for (const dir of ['converted', 'classics-winamp', 'existing']) {
  const manifestFile = path.join(work, dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) continue;
  for (const m of JSON.parse(fs.readFileSync(manifestFile, 'utf8'))) {
    if (m.error || !bans.has(key(m.name)) || banned.has(key(m.name))) continue;
    const file = path.join(work, dir, m.file);
    if (!fs.existsSync(file)) continue;
    presets[m.name] = JSON.parse(fs.readFileSync(file, 'utf8'));
    pack[m.name] = 'banned';
    banned.add(key(m.name));
  }
}
const classicNames = new Set((classicsPack.names || []).map(key));

// --- Stilart fra Cream of the Crops mapper ---
const styleOf = new Map();
for (const m of JSON.parse(fs.readFileSync(path.join(work, 'converted', 'manifest.json'), 'utf8'))) styleOf.set(key(m.name), m.style);
if (fs.existsSync(COTC)) {
  const walk = (d, rel = []) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p, [...rel, f]);
      else if (f.toLowerCase().endsWith('.milk') && !rel[0].startsWith('!')) {
        const k = key(path.basename(f, '.milk'));
        if (!styleOf.has(k)) styleOf.set(k, rel.slice(0, 2).join('/'));
      }
    }
  };
  walk(COTC);
}

// --- Målinger ---
const measured = new Map();
const addResults = (dir, files) => {
  const manifestFile = path.join(work, dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return;
  const names = new Map(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).map((m) => [m.file, m.name]));
  for (const file of files) {
    for (const r of readJsonl(path.join(work, file))) {
      const n = names.get(r.file);
      if (!n || r.error) continue;
      measured.set(key(n), { ...(measured.get(key(n)) || {}), ...r });
    }
  }
};
addResults('converted', ['results.jsonl', 'flash.jsonl']);
addResults('existing', ['flash-existing.jsonl']);
addResults('classics-winamp', ['classics-winamp-results.jsonl']);

// --- Træk fra koden ---
function codeTraits(p) {
  const b = p.baseVals || {};
  const shapes = (p.shapes || []).filter((s) => s && s.baseVals && s.baseVals.enabled);
  const waves = (p.waves || []).filter((w) => w && w.baseVals && w.baseVals.enabled);
  const audio = profilePreset(p);
  return {
    shapes: shapes.length,
    textured: shapes.filter((s) => s.baseVals.textured).length,
    triangles: shapes.filter((s) => Math.round(s.baseVals.sides) === 3).length,
    waves: waves.length,
    spectrum: waves.filter((w) => w.baseVals.spectrum).length,
    echo: Number(b.echo_alpha) || 0,
    decay: b.decay === undefined ? 0.98 : Number(b.decay),
    zoom: Math.abs((b.zoom === undefined ? 1 : Number(b.zoom)) - 1),
    rot: Math.abs(Number(b.rot) || 0),
    warpShader: (p.warp || '').length > 200 ? 1 : 0,
    compShader: (p.comp || '').length > 200 ? 1 : 0,
    bass: audio.affinity[0],
    mid: audio.affinity[1],
    treb: audio.affinity[2],
    reactivity: audio.reactivity,
  };
}

const METRICS = ['luma', 'motion', 'beatSync', 'colorful', 'detail', 'flicker'];
const CODE = ['shapes', 'textured', 'triangles', 'waves', 'spectrum', 'echo', 'decay', 'zoom', 'rot', 'warpShader', 'compShader', 'bass', 'mid', 'treb', 'reactivity'];
const FEATURES = [...METRICS, ...CODE];

const rows = Object.keys(presets).map((n) => {
  const m = measured.get(key(n)) || {};
  const c = codeTraits(presets[n]);
  const raw = FEATURES.map((f) => (METRICS.includes(f) ? (typeof m[f] === 'number' ? m[f] : null) : c[f]));
  return { n, raw, code: c, measured: Object.keys(m).length > 0, style: styleOf.get(key(n)) || null };
});

// Normaliser som placering blandt alle (0-1); manglende målinger får midten.
const ranks = FEATURES.map((_, i) => rows.map((r) => r.raw[i]).filter((v) => v !== null).sort((a, b) => a - b));
const rankOf = (i, v) => {
  if (v === null) return 0.5;
  const arr = ranks[i];
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((100 * lo) / Math.max(1, arr.length - 1)) / 100;
};
for (const r of rows) r.f = r.raw.map((v, i) => rankOf(i, v));

const { similarity } = require(path.join(root, 'src', 'shared', 'preset-similarity.js'));

// --- Gæt stilarten for dem uden: de 7 mest lignende med kendt stilart stemmer (vægtet efter lighed) ---
const K = 7;
const known = rows.filter((r) => r.style);
function guess(r, pool) {
  const near = pool
    .filter((o) => o !== r)
    .map((o) => [o, similarity(r.f, o.f)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, K);
  const votes = {};
  for (const [o, s] of near) votes[o.style] = (votes[o.style] || 0) + s;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
// Træfsikkerhed: gæt stilarten for dem, hvis stilart kendes, uden at se den (hele stilarten og hovedgruppen).
let exact = 0;
let family = 0;
for (const r of known) {
  const g = guess(r, known);
  if (g === r.style) exact += 1;
  if (g.split('/')[0] === r.style.split('/')[0]) family += 1;
}
for (const r of rows) if (!r.style) r.styleGuess = guess(r, known);

// --- Mærker ---
function tags(r) {
  const t = new Set();
  const style = r.style || r.styleGuess;
  if (style) for (const part of style.toLowerCase().split('/')) for (const w of part.split(/\s+/)) if (w.length > 2) t.add(w);
  const [luma, motion, beat, color, detail, flicker] = r.f;
  if (r.measured) {
    if (luma < 0.2) t.add('dark');
    if (luma > 0.8) t.add('bright');
    if (motion < 0.25) t.add('calm');
    if (motion > 0.75) t.add('energetic');
    if (beat > 0.75) t.add('on-the-beat');
    if (color > 0.75) t.add('colourful');
    if (color < 0.2) t.add('monochrome');
    if (detail > 0.8) t.add('detailed');
    if (flicker > 0.85) t.add('flashy');
  }
  if (r.code.textured >= 2) t.add('feedback-shapes');
  if (r.code.triangles >= 2) t.add('triangles');
  if (r.code.waves >= 2) t.add('waveforms');
  if (r.code.echo > 0.3) t.add('echo');
  if (r.code.decay < 0.9) t.add('trails-fade-fast');
  const audio = ['bass', 'mid', 'treb'].reduce((a, b) => (r.code[a] >= r.code[b] ? a : b));
  if (r.code[audio] > 0.5) t.add(`${audio}-driven`);
  return [...t];
}

const authorsOf = (n) =>
  n
    .split(' - ')[0]
    .split(/\s*(?:\+|&|,| and | n | ft\.? | vs\.? )\s*/i)
    .map((a) => a.replace(/^\$+\s*/, '').trim())
    .filter((a) => a && a.length < 40);

const catalog = { features: FEATURES, presets: {} };
for (const r of rows) {
  catalog.presets[r.n] = {
    pack: pack[r.n],
    banned: banned.has(key(r.n)) || undefined, // ikke i appen; kun til at lære smagen
    classic: classicNames.has(key(r.n)),
    authors: authorsOf(r.n),
    style: r.style,
    styleGuess: r.styleGuess || null,
    measured: r.measured,
    tags: tags(r),
    f: r.f,
  };
}
fs.writeFileSync(
  outFile,
  '/* Preset-kataloget: stilart, mærker og en lighedsvektor for hvert preset. Genereret af\n' +
    ' * scripts/build-preset-catalog.js; redigér ikke i hånden. Se docs/presets.md, "Kataloget". */\n' +
    'window.gridPresetCatalog = ' +
    JSON.stringify(catalog) +
    ';\n'
);
const withStyle = rows.filter((r) => r.style).length;
console.log(`Catalog: ${rows.length} presets, ${withStyle} with a Cream of the Crop style, ${rows.length - withStyle} guessed, ${rows.filter((r) => r.measured).length} measured.`);
console.log(`Style guess accuracy (leave-one-out on the ${known.length} with a known style): exact ${((100 * exact) / known.length).toFixed(0)} %, main group ${((100 * family) / known.length).toFixed(0)} %.`);
console.log(`${(fs.statSync(outFile).size / 1024).toFixed(0)} KB -> ${path.relative(root, outFile)}`);
