'use strict';

/*
 * Peters favoritter og derez til indstillingen "Use Peter's picks" (src/renderer/presets/peter-picks.js).
 * Kilder: hans ban- og behold-lister (scripts/preset-bans.txt, preset-keeps.txt) og hans stemmer i
 * data/preset-votes.jsonl (id'er, data/voters.json kalder "Peter"). Den seneste stemme pr. preset tæller, og
 * clear fjerner den. Skrives af scripts/release.js før hvert byg og af scripts/collect-votes.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const OUT = path.join(root, 'src', 'renderer', 'presets', 'peter-picks.js');

function readList(file) {
  return fs
    .readFileSync(path.join(root, 'scripts', file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function readVotes() {
  const file = path.join(root, 'data', 'preset-votes.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** { favorites, derez }, sorteret. */
function peterPicks() {
  const votersFile = path.join(root, 'data', 'voters.json');
  const names = fs.existsSync(votersFile) ? JSON.parse(fs.readFileSync(votersFile, 'utf8')) : {};
  const latest = new Map();
  for (const name of readList('preset-bans.txt')) latest.set(name, 'derez');
  for (const name of readList('preset-keeps.txt')) latest.set(name, 'keep');
  const mine = readVotes()
    .filter((v) => names[v.voter] === 'Peter')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const v of mine) {
    if (v.vote === 'clear') latest.delete(v.preset);
    else latest.set(v.preset, v.vote);
  }
  const pick = (vote) => [...latest].filter(([, v]) => v === vote).map(([n]) => n).sort((a, b) => a.localeCompare(b, 'en'));
  return { favorites: pick('keep'), derez: pick('derez') };
}

/** Skriver filen og returnerer antallet. Ændrer kun filen, hvis indholdet er nyt. */
function writePeterPicks() {
  const picks = peterPicks();
  const text =
    "/* Peters favoritter og derez til indstillingen \"Use Peter's picks\". Genereret af scripts/lib/peter-picks.js;\n" +
    ' * redigér ikke i hånden. */\n' +
    `window.gridPeterPicks = ${JSON.stringify(picks, null, 1)};\n`;
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old !== text) fs.writeFileSync(OUT, text);
  return { favorites: picks.favorites.length, derez: picks.derez.length, changed: old !== text, file: OUT };
}

module.exports = { peterPicks, writePeterPicks };
