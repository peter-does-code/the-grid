'use strict';

/*
 * Benchmark af musikmotoren på rigtige lydfiler og den syntetiske testsang:
 *
 *   node scripts/bench-music.js [mappe-til-rå-output]
 *
 * Kører `--musictest` på hver fil (offline og lydløst) og viser:
 *   låst      hvornår tempoet første gang er inden for 4 % af det rigtige og bliver der i 5 s
 *   rigtigt   andel af sekunderne fra 5 s, hvor tempoet er inden for 4 % af det rigtige
 *   skift     hvor mange gange tempoet skifter mere end 4 %
 *   jævne     andel af slag, der kommer én periode efter det forrige (±10 %)
 *   opb/drop  antal opbygninger og drops, motoren fandt (tider i sekunder)
 * Filer uden kendt tempo (Peters egne optagelser) får kun "skift" og "jævne"; de skal ikke blive værre.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const downloads = path.join(os.homedir(), 'Downloads');
const CASES = [
  { name: 'Init (NIN)', file: path.join(root, 'src', 'renderer', 'media', 'init.mp3'), bpm: 92.95 },
  // Langsomt shuffle-nummer med stille passager (triol- og 3:2-pulsen lokker tempoet væk fra 90).
  { name: 'Gospel of John Hurt', file: path.join(root, 'The Gospel of John Hurt.mp3'), bpm: 90 },
  // Radiohead i 10/4: helt jævnt slag, men takten er ikke 4 slag.
  { name: 'Everything In Its...', file: path.join(root, 'Everything In Its Right Place.mp3'), bpm: 124 },
  // Tredelt takt (ca. 130 BPM), hvor trommerne i nogle dele spiller halvtid (65).
  { name: 'Febersvan', file: path.join(root, 'Febersvan.mp3') },
  { name: 'Peter jam #1', file: path.join(downloads, 'Peter jam #1.wav') },
  { name: 'Something with Mist', file: path.join(downloads, 'Track 2 - Something with Mist.wav') },
  { name: 'slappa da bass', file: path.join(downloads, 'slappa da bass.wav') },
  { name: 'peters fav', file: path.join(downloads, 'peters fav.wav') },
  { name: 'Syntetisk (128 BPM)', file: null, bpm: 128 },
];

const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'the-grid-bench-'));
fs.mkdirSync(outDir, { recursive: true });

function run(c, i) {
  const args = [path.join(root, 'scripts', 'start.js'), '--musictest'];
  if (c.file) args.push(`--file=${c.file}`);
  const res = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  const text = (res.stdout || '') + (res.stderr || '');
  fs.writeFileSync(path.join(outDir, `${i}.json`), text);
  return JSON.parse(text.slice(text.indexOf('{')));
}

const near = (bpm, ref) => bpm && Math.abs(bpm - ref) / ref < 0.04;
const rows = [];
CASES.forEach((c, i) => {
  if (c.file && !fs.existsSync(c.file)) {
    rows.push({ name: c.name, note: 'filen findes ikke' });
    return;
  }
  const r = run(c, i);
  const timeline = c.file ? r.timeline : r.tempo.timeline;
  const row = { name: c.name };
  let switches = 0;
  let last = null;
  for (const x of timeline) {
    if (!x.bpm) continue;
    if (last !== null && Math.abs(x.bpm - last) / last > 0.04) switches += 1;
    last = x.bpm;
  }
  row.switches = switches;
  const evs = r.events || [];
  const at = (type) => evs.filter((e) => e.type === type).map((e) => Math.round(e.t));
  row.builds = at('buildup');
  row.drops = at('drop');
  if (c.file) row.regular = r.beats.regularPct;
  else row.regular = r.checks ? Object.values(r.checks).every(Boolean) ? 'alle tjek ok' : JSON.stringify(r.checks) : '';
  if (c.bpm) {
    const from5 = timeline.filter((x) => x.t >= 5);
    row.correct = Math.round((100 * from5.filter((x) => near(x.bpm, c.bpm)).length) / Math.max(1, from5.length));
    const lock = timeline.find((x, k) => near(x.bpm, c.bpm) && timeline.slice(k, k + 5).every((y) => near(y.bpm, c.bpm)));
    row.locked = lock ? lock.t : null;
  }
  rows.push(row);
});

console.log(`Rå output: ${outDir}\n`);
console.log('Fil'.padEnd(22) + 'Låst'.padEnd(8) + 'Rigtigt'.padEnd(10) + 'Skift'.padEnd(8) + 'Jævne'.padEnd(14) + 'Opbygninger / drops');
for (const row of rows) {
  if (row.note) {
    console.log(row.name.padEnd(22) + row.note);
    continue;
  }
  const locked = row.locked === undefined ? '-' : row.locked === null ? 'aldrig' : `${row.locked} s`;
  const correct = row.correct === undefined ? '-' : `${row.correct} %`;
  const bd = `[${row.builds.join(', ')}] / [${row.drops.join(', ')}]`;
  console.log(row.name.padEnd(22) + locked.padEnd(8) + correct.padEnd(10) + String(row.switches).padEnd(8) + String(row.regular).padEnd(14) + bd);
}
