'use strict';

/*
 * Samler brugernes stemmer på presets (K = kan lide, D = derez), som The Grid sender som issues til det private
 * releases-repo (src/main/votes.js):
 *
 *   node scripts/collect-votes.js            viser stemmerne pr. preset
 *   node scripts/collect-votes.js --apply    skriver dem i Peters lister og lukker de læste issues
 *
 * Med --apply: flere derez end kan-lide → scripts/preset-bans.txt (medmindre Peter selv har beholdt det);
 * flere kan-lide end derez → scripts/preset-keeps.txt. Næste pakke (scripts/build-preset-pack.js) bruger listerne.
 * Kræver gh logget ind som ejeren af releases-repoet.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { owner, repo } = require(path.join(root, 'src', 'main', 'update-config.js'));
const apply = process.argv.includes('--apply');
const key = (n) => String(n).trim().toLowerCase().split(/\s+/).join(' ');

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
}

const issues = JSON.parse(gh(['api', '--paginate', `repos/${owner}/${repo}/issues?state=open&per_page=100`])).filter(
  (i) => !i.pull_request && /^votes /.test(i.title) && (i.body || '').includes('the-grid-votes')
);
const tally = new Map(); // preset → { keep: Set(id), derez: Set(id) }
for (const issue of issues) {
  let data;
  try {
    data = JSON.parse(issue.body.split('```json')[1].split('```')[0]);
  } catch {
    console.warn(`Issue #${issue.number}: could not read the votes, skipped.`);
    continue;
  }
  for (const v of data.votes || []) {
    if (!tally.has(v.preset)) tally.set(v.preset, { keep: new Set(), derez: new Set() });
    const t = tally.get(v.preset);
    // Én stemme pr. bruger og preset: den seneste tæller.
    t.keep.delete(data.id);
    t.derez.delete(data.id);
    t[v.vote === 'keep' ? 'keep' : 'derez'].add(data.id);
  }
}

const voters = new Set(issues.map((i) => i.title.split(' ')[1]));
console.log(`${issues.length} vote issues from ${voters.size} user(s), ${tally.size} presets\n`);
const rows = [...tally].map(([name, t]) => ({ name, keep: t.keep.size, derez: t.derez.size })).sort((a, b) => b.derez - a.derez || b.keep - a.keep);
for (const r of rows) console.log(`${String(r.keep).padStart(3)} like  ${String(r.derez).padStart(3)} derez   ${r.name}`);

if (!apply) {
  if (rows.length) console.log('\nRun with --apply to add them to scripts/preset-bans.txt and scripts/preset-keeps.txt.');
  process.exit(0);
}
const readList = (f) =>
  new Set(
    fs
      .readFileSync(path.join(__dirname, f), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(key)
  );
const bans = readList('preset-bans.txt');
const keeps = readList('preset-keeps.txt');
const newBans = rows.filter((r) => r.derez > r.keep && !bans.has(key(r.name)) && !keeps.has(key(r.name)));
const newKeeps = rows.filter((r) => r.keep > r.derez && !keeps.has(key(r.name)) && !bans.has(key(r.name)));
if (newBans.length) fs.appendFileSync(path.join(__dirname, 'preset-bans.txt'), newBans.map((r) => r.name).join('\n') + '\n');
if (newKeeps.length) fs.appendFileSync(path.join(__dirname, 'preset-keeps.txt'), newKeeps.map((r) => r.name).join('\n') + '\n');
for (const issue of issues) gh(['api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${issue.number}`, '-f', 'state=closed']);
console.log(`\nAdded ${newBans.length} to the ban list and ${newKeeps.length} to the keep list; closed ${issues.length} issue(s).`);
console.log('Rebuild the pack (docs/presets.md) and release to bring it to everyone.');
