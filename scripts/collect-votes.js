'use strict';

/*
 * Samler brugernes stemmer på presets (K = kan lide, D = derez, clear = fortrudt) til en analyse senere.
 * The Grid sender dem som issues til det private releases-repo (src/main/votes.js):
 *
 *   node scripts/collect-votes.js          henter nye stemmer ind i data/preset-votes.jsonl, lukker de læste
 *                                          issues og viser et overblik
 *   node scripts/collect-votes.js --all    viser også stemmerne på hvert preset
 *
 * Stemmerne ændrer ikke noget af sig selv: derez skjuler kun presettet for brugeren selv, og ingen andres stemmer
 * kommer på ban- eller behold-listen (Peter 02-10-2026). Det besluttes først, når der er data nok til en analyse.
 *
 * - data/preset-votes.jsonl: én stemme pr. linje, { preset, vote, at, voter, version, source, issue }. Peters
 *   stemmer fra kildekoden og review-tilstanden skrives der direkte af appen (voter "peter").
 * - data/voters.json: navne på kendte id'er, fx Peters installerede app.
 * - Peters egne lister (scripts/preset-bans.txt, preset-keeps.txt) tælles med som Peters stemmer uden tidspunkt.
 *
 * Kræver gh logget ind som ejeren af releases-repoet. Commit data/ bagefter, så stemmerne er gemt.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { owner, repo } = require(path.join(root, 'src', 'main', 'update-config.js'));
const DATA = path.join(root, 'data', 'preset-votes.jsonl');
const VOTERS = path.join(root, 'data', 'voters.json');
const showAll = process.argv.includes('--all');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function readData() {
  if (!fs.existsSync(DATA)) return [];
  return fs
    .readFileSync(DATA, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function readList(file) {
  return fs
    .readFileSync(path.join(__dirname, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// 1. Nye issues ind i datafilen.
const data = readData();
const seen = new Set(data.map((v) => v.issue).filter(Boolean));
const issues = JSON.parse(gh(['api', '--paginate', `repos/${owner}/${repo}/issues?state=open&per_page=100`])).filter(
  (i) => !i.pull_request && /^votes /.test(i.title) && (i.body || '').includes('the-grid-votes')
);
let added = 0;
const read = [];
for (const issue of issues) {
  if (seen.has(issue.number)) {
    read.push(issue);
    continue;
  }
  let batch;
  try {
    batch = JSON.parse(issue.body.split('```json')[1].split('```')[0]);
  } catch {
    console.warn(`Issue #${issue.number}: could not read the votes, left open.`);
    continue;
  }
  const lines = (batch.votes || []).map((v) => ({
    preset: v.preset,
    vote: v.vote,
    at: v.at,
    voter: batch.id,
    version: batch.version,
    source: 'app',
    issue: issue.number,
  }));
  if (lines.length) fs.appendFileSync(DATA, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  data.push(...lines);
  added += lines.length;
  read.push(issue);
}
// Først lukkes de, når stemmerne står i datafilen.
for (const issue of read) gh(['api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${issue.number}`, '-f', 'state=closed']);
console.log(`Fetched ${added} new vote(s) from ${read.length} issue(s).${added ? ' Commit data/ to keep them.' : ''}\n`);

// 2. Overblik: den seneste stemme pr. bruger og preset tæller (clear = ingen stemme).
const names = fs.existsSync(VOTERS) ? JSON.parse(fs.readFileSync(VOTERS, 'utf8')) : {};
const who = (id) => names[id] || id;
const latest = new Map(); // "person\npreset" → vote
const pushVote = (person, preset, vote) => {
  const k = `${person}\n${preset}`;
  if (vote === 'clear') latest.delete(k);
  else latest.set(k, vote);
};
for (const name of readList('preset-bans.txt')) pushVote('Peter', name, 'derez');
for (const name of readList('preset-keeps.txt')) pushVote('Peter', name, 'keep');
for (const v of data.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))) pushVote(who(v.voter), v.preset, v.vote);

const people = new Map(); // person → { keep, derez }
const presets = new Map(); // preset → { peter, keep, derez }
for (const [k, vote] of latest) {
  const [person, preset] = k.split('\n');
  if (!people.has(person)) people.set(person, { keep: 0, derez: 0 });
  people.get(person)[vote] += 1;
  if (!presets.has(preset)) presets.set(preset, { peter: null, keep: 0, derez: 0 });
  const p = presets.get(preset);
  if (person === 'Peter') p.peter = vote;
  else p[vote] += 1;
}
console.log('Per person (current votes):');
for (const [person, c] of [...people].sort((a, b) => b[1].keep + b[1].derez - (a[1].keep + a[1].derez))) {
  console.log(`  ${person.padEnd(10)} ${String(c.keep).padStart(4)} like ${String(c.derez).padStart(4)} derez`);
}
const others = [...presets].filter(([, p]) => p.keep + p.derez > 0);
console.log(`\n${presets.size} presets have a vote; ${others.length} from others than Peter.`);
if (showAll) {
  console.log('\nPeter   others (like/derez)   preset');
  for (const [name, p] of [...presets].sort((a, b) => b[1].derez - a[1].derez || b[1].keep - a[1].keep || a[0].localeCompare(b[0]))) {
    console.log(`${(p.peter || '-').padEnd(7)} ${String(p.keep).padStart(4)} / ${String(p.derez).padEnd(12)} ${name}`);
  }
}
