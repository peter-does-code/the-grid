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
if (!dir || !resultsFile) {
  console.error('Brug: node scripts/build-preset-pack.js <mappe fra convert-presets> <results.json> [--total=1000]');
  process.exit(1);
}

const LIMITS = { minLuma: 0.015, maxLuma: 0.85, minMotion: 0.004, maxMsPerFrame: 10 };

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
  if (r.luma < LIMITS.minLuma) return reject('sort');
  if (r.luma > LIMITS.maxLuma) return reject('hvidt');
  if (r.motion < LIMITS.minMotion) return reject('står stille');
  if (r.msPerFrame > LIMITS.maxMsPerFrame) return reject('for tungt');
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
const chosen = [];
for (const s of styles) {
  const slots = Math.max(2, Math.round((TOTAL * weight[s]) / weightSum));
  chosen.push(...candidates[s].sort((a, b) => b.score - a.score).slice(0, slots));
}
chosen.sort((a, b) => b.score - a.score);
const final = chosen.slice(0, TOTAL);

const presets = {};
for (const r of final) {
  const m = byFile.get(r.file);
  presets[m.name] = JSON.parse(fs.readFileSync(path.join(dir, r.file), 'utf8'));
}
const outDir = path.join(root, 'src', 'renderer', 'presets');
fs.mkdirSync(outDir, { recursive: true });
const js =
  '/* Cream of the Crop (projectM, kurateret af Jason Fletcher / ISOSCELES): de bedste ' +
  final.length +
  ' presets\n * efter The Grids preset-test. Genereret af scripts/build-preset-pack.js; redigér ikke i hånden.\n' +
  ' * MilkDrop-presets er frigivet frit af deres forfattere (se docs/presets.md). */\n' +
  'window.gridPresetsCreamOfTheCrop = { getPresets: function () { return ' +
  JSON.stringify(presets) +
  '; } };\n';
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

console.log(`Testet: ${results.length}, godkendt: ${ok.length}, valgt: ${final.length} fra ${styles.length} stilarter`);
console.log('Sorteret fra:', JSON.stringify(rejected));
console.log(`Pakke: ${(js.length / 1e6).toFixed(1)} MB`);
