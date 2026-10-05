'use strict';

/*
 * Bygger review-pakken (src/renderer/presets/review-pack.js) til review-tilstanden, så Peter kan stemme:
 *
 *   npm run presets:review                      50 nye kandidater efter Peters smag, og åbner review-vinduet
 *   node scripts/build-review-pack.js [--count=50] [--flashers] [--classics [--missing]] [--no-open]
 *
 * Kandidaterne er presets fra presets-work (se docs/presets.md), der virker, men ikke er med i pakken, og som Peter
 * ikke har stemt om. De rangeres efter Peters smag fra hans review (02-10-2026): takt minus blink minus lysstyrke
 * (AUC 0,81 på 42 behold mod 68 ban). Højst 2 pr. stilart. Med --flashers: kun dem, der blev sorteret fra for blink.
 * I review-vinduet bladrer man med ← →; K beholder (scripts/preset-keeps.txt), D bandlyser (scripts/preset-bans.txt).
 * Bagefter: npm run presets:pack bygger pakken med stemmerne.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const work = path.join(root, 'presets-work');
const args = process.argv.slice(2);
const countArg = args.find((a) => a.startsWith('--count='));
const COUNT = countArg ? Number(countArg.split('=')[1]) : 50;
const FLASHERS = args.includes('--flashers');

const key = (n) => String(n).trim().toLowerCase().split(/\s+/).join(' ');
const readList = (f) =>
  fs
    .readFileSync(path.join(__dirname, f), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(key);
const readJsonl = (f) =>
  fs
    .readFileSync(path.join(work, f), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const voted = new Set([...readList('preset-keeps.txt'), ...readList('preset-bans.txt')]);
const inPack = new Set(
  fs
    .readFileSync(path.join(root, 'src', 'renderer', 'presets', 'cream-of-the-crop.txt'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => key(l.split('|').pop()))
);
const builtIn = new Set(JSON.parse(fs.readFileSync(path.join(work, 'existing', 'manifest.json'), 'utf8')).map((m) => key(m.name)));
const byFile = new Map(JSON.parse(fs.readFileSync(path.join(work, 'converted', 'manifest.json'), 'utf8')).map((m) => [m.file, m]));
const results = new Map(readJsonl('results.jsonl').map((r) => [r.file, r]));

const pool = [];
// --classics: Winamp-klassikerne i pakken (src/renderer/presets/winamp-classics.js), som Peter ikke har stemt om.
// K kommer på behold-listen (og dermed Peters favoritter), D på ban-listen og ud af pakken for alle.
const CLASSICS = args.includes('--classics');
// --classics --missing: i stedet de klassikere, preset-testen sorterede fra (sort, hvidt, stille, blink), men som
// kan tegnes. Testen tager kun 3 s; Peter afgør med egne øjne (K tager dem med, D bandlyser).
const MISSING = args.includes('--missing');
const classicPresets = {};
if (CLASSICS) {
  global.window = global.window || {};
  require(path.join(root, 'src', 'renderer', 'presets', 'winamp-classics.js'));
  const inPackClassics = window.gridPresetsWinampClassics.getPresets();
  const clDir = path.join(work, 'classics-winamp');
  const clByFile = new Map(JSON.parse(fs.readFileSync(path.join(clDir, 'manifest.json'), 'utf8')).map((m) => [m.file, m]));
  for (const r of readJsonl('classics-winamp-results.jsonl')) {
    const m = clByFile.get(r.file);
    if (!m || m.error || r.error || r.linkFailed || voted.has(key(m.name))) continue;
    if (MISSING ? inPackClassics[m.name] || inPack.has(key(m.name)) || builtIn.has(key(m.name)) : !inPackClassics[m.name]) continue;
    classicPresets[m.name] = inPackClassics[m.name] || JSON.parse(fs.readFileSync(path.join(clDir, m.file), 'utf8'));
    pool.push({ m: { ...m, style: 'classics' }, taste: r.beatSync - (r.flicker || 0) - r.luma });
  }
}
for (const f of CLASSICS ? [] : readJsonl('flash.jsonl')) {
  const m = byFile.get(f.file);
  const r = results.get(f.file);
  if (!m || !r || r.error || r.linkFailed) continue;
  // Samme grundkrav som pakken (sort, hvidt, fladt, stille, for tungt).
  if (r.luma < 0.03 || r.luma > 0.85 || r.detail < 0.035 || r.motion < 0.004 || r.msPerFrame > 10) continue;
  const k = key(m.name);
  if (inPack.has(k) || voted.has(k) || builtIn.has(k)) continue;
  if (FLASHERS !== f.flicker >= 0.5) continue;
  pool.push({ m, taste: f.beatSync - f.flicker - f.luma });
}
pool.sort((a, b) => b.taste - a.taste);
const perStyle = new Map();
const picked = [];
for (const c of pool) {
  if (picked.length >= COUNT) break;
  if (!CLASSICS && (perStyle.get(c.m.style) || 0) >= 2) continue;
  perStyle.set(c.m.style, (perStyle.get(c.m.style) || 0) + 1);
  picked.push(c);
}
const presets = {};
for (const c of picked) {
  presets[c.m.name] = CLASSICS ? classicPresets[c.m.name] : JSON.parse(fs.readFileSync(path.join(work, 'converted', c.m.file), 'utf8'));
}
fs.writeFileSync(
  path.join(root, 'src', 'renderer', 'presets', 'review-pack.js'),
  '/* Kun til review-tilstand (--review). Genereret af scripts/build-review-pack.js; ikke i git eller installationen. */\n' +
    'window.gridReviewPresets = ' +
    JSON.stringify(presets) +
    ';\n'
);
console.log(`${picked.length} presets to review (of ${pool.length} candidates, ${perStyle.size} styles).`);
if (!picked.length) process.exit(0);
if (!args.includes('--no-open')) {
  spawn(process.execPath, [path.join(__dirname, 'start.js'), '--review'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
  console.log('Review window opening: ← → to browse, K keep, D derez. Then: npm run presets:pack');
}
