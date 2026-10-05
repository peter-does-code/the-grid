'use strict';

/*
 * Vælger de bedste konverterede presets og bygger en preset-pakke til The Grid:
 *
 *   node scripts/build-preset-pack.js <mappe fra convert-presets> <results.jsonl fra --presettest> [--total=1000]
 *
 * Skriver src/renderer/presets/cream-of-the-crop.js (samme form som butterchurn-presets: et globalt objekt
 * med getPresets()) og src/renderer/presets/cream-of-the-crop.txt (liste over de valgte og deres mål).
 *
 * Et preset sorteres fra, hvis det fejler, shaderen ikke kan oversættes, billedet står stille eller er helt
 * hvidt, det er for tungt at tegne, eller navnet allerede findes blandt de indbyggede presets. De øvrige får
 * en score, hvor det vigtigste er, at billedet følger musikken (beatSync), og derefter bevægelse, farver,
 * detaljer og en behagelig lysstyrke. Hver stilart (fx Reaction/Liquid Ripples) får pladser efter sin
 * størrelse, mindst 2, så alle slags billeder er med; de bedste i stilarten vinder.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const [dir, resultsFile] = args.filter((a) => !a.startsWith('--'));
const totalArg = args.find((a) => a.startsWith('--total='));
const TOTAL = totalArg ? Number(totalArg.split('=')[1]) : 1000;
const minArg = args.find((a) => a.startsWith('--min-score='));
// Under denne score kommer et preset ikke med, heller ikke på stilartens faste pladser.
const MIN_SCORE = minArg ? Number(minArg.split('=')[1]) : 0.35;
if (!dir || !resultsFile) {
  console.error('Brug: node scripts/build-preset-pack.js <mappe fra convert-presets> <results.json> [--total=1000]');
  process.exit(1);
}

const LIMITS = { minLuma: 0.03, maxLuma: 0.85, minDetail: 0.035, minMotion: 0.004, maxMsPerFrame: 10 };

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const byFile = new Map(manifest.map((m) => [m.file, m]));
// results.jsonl fra --presettest: én JSON-linje pr. preset (en ældre results.json har dem under "results").
const raw = fs.readFileSync(resultsFile, 'utf8');
const results = raw.trimStart().startsWith('{"ok"')
  ? JSON.parse(raw).results
  : raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

// De indbyggede presets må ikke komme igen under samme navn.
const existing = new Set();
for (const pack of ['butterchurnPresets', 'butterchurnPresetsExtra', 'butterchurnPresetsExtra2', 'butterchurnPresetsMD1', 'butterchurnPresetsMinimal', 'butterchurnPresetsNonMinimal']) {
  const mod = require(path.join(root, 'node_modules', 'butterchurn-presets', 'lib', `${pack}.min.js`));
  for (const name of Object.keys((mod.default || mod).getPresets())) existing.add(name.toLowerCase());
}

// Presets, Peter har bedt om at få fjernet (scripts/preset-bans.txt). Mellemrum tæller ikke: appen viser
// dobbelte mellemrum som ét, så navnet skrives, som det ses.
const banKey = (name) => String(name).trim().toLowerCase().split(/\s+/).join(' ');
const banned = new Set(
  fs
    .readFileSync(path.join(__dirname, 'preset-bans.txt'), 'utf8')
    .split('\n')
    .map((l) => banKey(l))
    .filter((l) => l && !l.startsWith('#'))
);

// Blink: --flicker=<fil>,<fil> med målinger fra --presettest (flicker = andel af billeder, hvor hele billedets
// lysstyrke springer). Over 0,5 er det konstant stroboskop (Peters klage 01-10-2026: "flashing white lights constantly").
const flickerArg = args.find((a) => a.startsWith('--flicker='));
const flicker = new Map();
const measured = new Map(); // hele målingen fra blink-kørslen (til preset-stats.js)
for (const file of flickerArg ? flickerArg.slice('--flicker='.length).split(',') : []) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (typeof r.flicker === "number") {
      flicker.set(r.file, r.flicker);
      measured.set(r.file, r);
    }
  }
}
const MAX_FLICKER = 0.5;
// Peters smag (review af 65 blinkere, 01-10-2026): blink er fint, når det følger musikken. Takt minus blink
// adskilte hans "behold" fra "ban" bedst (AUC 0,80; takt alene 0,77, blink alene 0,73). Med mindst -0,2 ville
// 11 af hans 14 "behold" være kommet med og 10 af 51 "ban". Hans egne valg (keeps/bans) går altid forud.
const TASTE_MARGIN = -0.2;
const flashesWithMusic = (rec) => rec && rec.beatSync - rec.flicker >= TASTE_MARGIN;

// Presets, Peter vil beholde trods blink (K i review-tilstanden, scripts/preset-keeps.txt).
const keeps = new Set(
  fs
    .readFileSync(path.join(__dirname, 'preset-keeps.txt'), 'utf8')
    .split('\n')
    .map((l) => banKey(l))
    .filter((l) => l && !l.startsWith('#'))
);

const rejected = {};
const reject = (why) => {
  rejected[why] = (rejected[why] || 0) + 1;
  return false;
};
const ok = results.filter((r) => {
  const m = byFile.get(r.file);
  if (!m) return reject('ikke i manifest');
  if (r.error) return reject('fejl');
  if (r.linkFailed) return reject('shader kan ikke oversættes');
  if (existing.has(m.name.toLowerCase())) return reject('findes allerede');
  if (banned.has(banKey(m.name))) return reject('fjernet af Peter');
  if (r.luma < LIMITS.minLuma) return reject('sort');
  if (r.luma > LIMITS.maxLuma) return reject('hvidt');
  if (r.detail < LIMITS.minDetail) return reject('fladt');
  if (r.motion < LIMITS.minMotion) return reject('står stille');
  if (r.msPerFrame > LIMITS.maxMsPerFrame) return reject('for tungt');
  if ((flicker.get(r.file) || 0) >= MAX_FLICKER && !keeps.has(banKey(m.name)) && !flashesWithMusic(measured.get(r.file))) {
    return reject('blinker');
  }
  if (flickerArg && !flicker.has(r.file)) return reject('blink ikke målt');
  return true;
});

// Score ud fra placering blandt alle (0-1), så målenes forskellige skalaer ikke betyder noget.
function ranks(key, transform = (x) => x) {
  const sorted = ok.map((r) => transform(r[key])).sort((a, b) => a - b);
  return (r) => {
    const v = transform(r[key]);
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / Math.max(1, sorted.length - 1);
  };
}
const beat = ranks('beatSync');
const motion = ranks('motion', (m) => Math.min(m, 0.2)); // meget voldsom bevægelse (strobe) giver ikke ekstra
const color = ranks('colorful');
const detail = ranks('detail');
const pleasant = ranks('luma', (l) => -Math.abs(Math.log((l + 0.02) / 0.27))); // tættest på ca. 0,25
for (const r of ok) {
  // Reagerer den mere på musikken end på stilheden? Presets, der bevæger sig lige meget uanset lyden, trækkes lidt ned.
  const reacts = r.motion > 1.2 * r.silentMotion ? 0.05 : 0;
  r.score = 0.4 * beat(r) + 0.2 * motion(r) + 0.15 * color(r) + 0.15 * detail(r) + 0.1 * pleasant(r) + reacts;
}

// Pladser pr. stilart efter størrelse (i Cream of the Crop), mindst 2.
const styleSize = {};
for (const m of manifest) styleSize[m.style] = (styleSize[m.style] || 0) + 1;
const candidates = {};
for (const r of ok) (candidates[byFile.get(r.file).style] = candidates[byFile.get(r.file).style] || []).push(r);
const styles = Object.keys(candidates);
const weight = Object.fromEntries(styles.map((s) => [s, Math.sqrt(styleSize[s])]));
const weightSum = styles.reduce((s, x) => s + weight[x], 0);
// Højst 2 fra hver familie: forfatter og titel (de to første led af navnet), fx "goody + flexi - emotive
// dissonance - turmoil" og "... - integral anomaly mix" er samme preset i forskellige udgaver.
const familyOf = (name) =>
  name
    .split(' - ')
    .slice(0, 2)
    .join(' - ')
    .replace(/[\s_-]*[\d.]+[a-z]?\s*$/i, '')
    .toLowerCase()
    .trim();
const perFamily = new Map();
const chosen = [];
for (const s of styles) {
  const slots = Math.max(2, Math.round((TOTAL * weight[s]) / weightSum));
  const ranked = candidates[s].filter((r) => r.score >= MIN_SCORE).sort((a, b) => b.score - a.score);
  let taken = 0;
  for (const r of ranked) {
    if (taken >= slots) break;
    const fam = familyOf(byFile.get(r.file).name);
    if ((perFamily.get(fam) || 0) >= 2) continue;
    perFamily.set(fam, (perFamily.get(fam) || 0) + 1);
    chosen.push(r);
    taken += 1;
  }
}
// Peters "behold" (scripts/preset-keeps.txt) kommer altid med, når de virker, uanset stilartens pladser,
// familiegrænsen og minimumsscoren.
const chosenFiles = new Set(chosen.map((r) => r.file));
for (const r of ok) if (!chosenFiles.has(r.file) && keeps.has(banKey(byFile.get(r.file).name))) chosen.push(r);
chosen.sort((a, b) => b.score - a.score);
const final = chosen.slice(0, Math.max(TOTAL, chosen.length));

const presets = {};
for (const r of final) {
  const m = byFile.get(r.file);
  presets[m.name] = JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8'));
}
// --extra=<mappe>,<mappe>: konverterede presets fra søgninger uden for udvalget (fx fern-lignende stilarter fra hele
// Cream of the Crop, 05-10-2026). Kun dem, Peter har givet K, kommer med.
const extraArg = args.find((a) => a.startsWith('--extra='));
let extras = 0;
for (const exDir of extraArg ? extraArg.slice('--extra='.length).split(',') : []) {
  const manifestFile = path.join(root, exDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) continue;
  for (const m of JSON.parse(fs.readFileSync(manifestFile, 'utf8'))) {
    if (m.error || presets[m.name] || existing.has(m.name.toLowerCase()) || !keeps.has(banKey(m.name)) || banned.has(banKey(m.name))) continue;
    presets[m.name] = JSON.parse(fs.readFileSync(path.join(root, exDir, m.file), 'utf8'));
    extras += 1;
  }
}
if (extraArg) console.log(`Fra søgninger (--extra), med K: ${extras}`);
const outDir = path.join(root, 'src', 'renderer', 'presets');
fs.mkdirSync(outDir, { recursive: true });
const js =
  '/* Cream of the Crop (projectM, kurateret af Jason Fletcher / ISOSCELES): de bedste ' +
  final.length +
  ' presets\n * efter The Grids preset-test. Genereret af scripts/build-preset-pack.js; redigér ikke i hånden.\n' +
  ' * MilkDrop-presets er frigivet frit af deres forfattere (se docs/presets.md). */\n' +
  'window.gridPresetsCreamOfTheCrop = { getPresets: function () { return ' +
  JSON.stringify(presets) +
  '; },\n  // Fra scripts/preset-bans.txt: visualizer.js fjerner også de indbyggede presets med disse navne.\n  bans: ' +
  JSON.stringify([...banned]) +
  ' };\n';
fs.writeFileSync(path.join(outDir, 'cream-of-the-crop.js'), js);
const list = final
  .map((r) => {
    const m = byFile.get(r.file);
    return `${r.score.toFixed(3)}  beat ${r.beatSync.toFixed(2)}  ${m.style}  |  ${m.name}`;
  })
  .join('\n');
fs.writeFileSync(path.join(outDir, 'cream-of-the-crop.txt'), list + '\n');
// De valgte som manifest (bedste først), så de kan ses på kontaktark:
//   node scripts/start.js --presettest --dir=<mappe> --manifest=<mappe>/chosen.json --out=<fil> --sheets=<mappe>
fs.writeFileSync(path.join(dir, 'chosen.json'), JSON.stringify(final.map((r) => byFile.get(r.file))));

// Målingerne til valget af preset (src/shared/music-engine.js, scorePreset): for pakkens presets og, med
// --existing=<mappe>,<jsonl>, de indbyggede. Hvert mål er gemt som placering blandt alle (0-1), så de kan
// sammenlignes direkte: [lysstyrke, bevægelse, takt, farver, detaljer].
const statsByName = {};
for (const r of final) {
  const m = measured.get(r.file);
  if (m) statsByName[byFile.get(r.file).name] = m;
}
const existingArg = args.find((a) => a.startsWith('--existing='));
if (existingArg) {
  const [exDir, exResults] = existingArg.slice('--existing='.length).split(',');
  const names = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(exDir, 'manifest.json'), 'utf8')).map((m) => [m.file, m.name]));
  for (const line of fs.readFileSync(exResults, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!r.error && names[r.file] && !banned.has(banKey(names[r.file]))) statsByName[names[r.file]] = r;
  }
}
// Winamp-klassikerne (--classics=<mappe>,<jsonl>): MilkDrops egen pakke fra den sidste Winamp-udgave
// (projectM-visualizer/presets-milkdrop-original). Peter og hans gæster savnede det gamle Winamp-udtryk
// (05-10-2026). Alle, der virker, kommer med uden score og stilartspladser; samme tekniske frasortering og
// blinkregel som ovenfor, og Peters ban-liste gælder.
const classicsArg = args.find((a) => a.startsWith('--classics='));
if (classicsArg) {
  const [clDir, clResults] = classicsArg.slice('--classics='.length).split(',');
  const clManifest = new Map(JSON.parse(fs.readFileSync(path.join(clDir, 'manifest.json'), 'utf8')).map((m) => [m.file, m]));
  const taken = new Set([...existing, ...Object.keys(presets).map((n) => n.toLowerCase())]);
  const clRejected = {};
  const no = (why) => {
    clRejected[why] = (clRejected[why] || 0) + 1;
    return false;
  };
  const classics = {};
  for (const line of fs.readFileSync(clResults, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const m = clManifest.get(r.file);
    const keep = (() => {
      if (!m) return no('ikke i manifest');
      if (r.error) return no('fejl');
      if (r.linkFailed) return no('shader kan ikke oversættes');
      if (taken.has(m.name.toLowerCase())) return no('findes allerede');
      if (banned.has(banKey(m.name))) return no('fjernet af Peter');
      // Peters "behold" går forud for målingerne: testen tager 3 s, og en klassiker kan starte mørkt eller
      // bevæge sig langsomt (npm run presets:classics -- --missing).
      if (keeps.has(banKey(m.name))) return true;
      if (r.luma < LIMITS.minLuma) return no('sort');
      if (r.luma > LIMITS.maxLuma) return no('hvidt');
      if (r.motion < LIMITS.minMotion) return no('står stille');
      if (r.msPerFrame > LIMITS.maxMsPerFrame) return no('for tungt');
      if ((r.flicker || 0) >= MAX_FLICKER && !keeps.has(banKey(m.name)) && !flashesWithMusic(r)) return no('blinker');
      return true;
    })();
    if (!keep) continue;
    classics[m.name] = JSON.parse(fs.readFileSync(path.join(clDir, r.file), 'utf8'));
    taken.add(m.name.toLowerCase());
    if (typeof r.flicker === 'number') statsByName[m.name] = r;
  }
  fs.writeFileSync(
    path.join(outDir, 'winamp-classics.js'),
    '/* Winamp-klassikerne: MilkDrops egen preset-pakke fra den sidste officielle udgave (projectM-visualizer/\n' +
      ' * presets-milkdrop-original), dem der virker i The Grid. Genereret af scripts/build-preset-pack.js; redigér ikke\n' +
      ' * i hånden. MilkDrop-presets er frigivet frit af deres forfattere (se docs/presets.md). */\n' +
      'window.gridPresetsWinampClassics = { getPresets: function () { return ' +
      JSON.stringify(classics) +
      '; },\n  // Alle navne i MilkDrops pakke, også dem, der allerede fandtes i de andre pakker: "Classic Winamp mode"\n' +
      '  // bruger kun disse (visualizer.js, setOnly).\n  names: ' +
      JSON.stringify([...clManifest.values()].map((m) => m.name).sort((a, b) => a.localeCompare(b, 'en'))) +
      ' };\n'
  );
  fs.writeFileSync(path.join(outDir, 'winamp-classics.txt'), Object.keys(classics).sort((a, b) => a.localeCompare(b, 'en')).join('\n') + '\n');
  console.log(`Winamp-klassikere: ${Object.keys(classics).length} med. Sorteret fra:`, JSON.stringify(clRejected));
}

const KEYS = ['luma', 'motion', 'beatSync', 'colorful', 'detail'];
const entries = Object.entries(statsByName);
const sortedBy = Object.fromEntries(KEYS.map((k) => [k, entries.map(([, r]) => r[k] || 0).sort((a, b) => a - b)]));
const rankOf = (k, v) => {
  const arr = sortedBy[k];
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((100 * lo) / Math.max(1, arr.length - 1)) / 100;
};
const stats = Object.fromEntries(entries.map(([name, r]) => [name, KEYS.map((k) => rankOf(k, r[k] || 0))]));
fs.writeFileSync(
  path.join(outDir, 'preset-stats.js'),
  '/* Målinger fra The Grids preset-test, som placering blandt alle presets (0-1): [lysstyrke, bevægelse, takt,\n' +
    ' * farver, detaljer]. Genereret af scripts/build-preset-pack.js; bruges af scorePreset i music-engine.js. */\n' +
    'window.gridPresetStats = ' +
    JSON.stringify(stats) +
    ';\n'
);
console.log(`Målinger til valget: ${entries.length} presets`);

console.log(`Testet: ${results.length}, godkendt: ${ok.length}, valgt: ${final.length} fra ${styles.length} stilarter`);
console.log('Sorteret fra:', JSON.stringify(rejected));
console.log(`Pakke: ${(js.length / 1e6).toFixed(1)} MB`);
