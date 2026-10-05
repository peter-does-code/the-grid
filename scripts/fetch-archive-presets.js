'use strict';

/*
 * Henter MilkDrop-presets fra Internet Archives store samling (ca. 43.000 emner med id "md_..."), til at lede efter
 * presets, der ikke er i Cream of the Crop, Winamp eller projectM (05-10-2026: sådan blev "Zylot & Idiot - Face" og
 * Flexis "shader circus"-serie fundet).
 *
 *   node scripts/fetch-archive-presets.js <ud-mappe> "<søgning i titlen>" [--known=<mappe>,<mappe>] [--workers=6]
 *
 * Søgningen er Internet Archives syntaks, fx 'flexi' eller '"shader circus"'. Presets, hvis navn allerede findes i
 * --known-mapperne (.milk-filer), springes over, og det, der allerede er hentet, hentes ikke igen, så en afbrudt
 * kørsel kan fortsætte. Filerne får titlen som navn. Kræver net; kun archive.org.
 */
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const [out, query] = args.filter((a) => !a.startsWith('--'));
const opt = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
if (!out || !query) {
  console.error('Usage: node scripts/fetch-archive-presets.js <out-dir> "<title query>" [--known=<dir>,<dir>] [--workers=6]');
  process.exit(1);
}
const WORKERS = Number(opt('workers')) || 6;
const key = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function walk(d, list = []) {
  if (!fs.existsSync(d)) return list;
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, list);
    else if (f.toLowerCase().endsWith('.milk')) list.push(path.basename(f, '.milk'));
  }
  return list;
}

async function json(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status < 500) throw new Error(`${res.status}`);
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return null;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const known = new Set();
  for (const dir of (opt('known') || '').split(',').filter(Boolean)) for (const n of walk(dir)) known.add(key(n));
  for (const n of walk(out)) known.add(key(n));

  // Alle emner, der passer til søgningen (sidevis).
  const items = [];
  for (let page = 1; ; page++) {
    const q = encodeURIComponent(`identifier:md_* AND title:(${query})`);
    const data = await json(`https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&rows=500&page=${page}&output=json`);
    const docs = (data && data.response && data.response.docs) || [];
    items.push(...docs);
    if (docs.length < 500) break;
  }
  // Arkivets titler mangler " - " efter forfatteren ("Flexi shader circus"); de sammenlignes uden tegn.
  const todo = items.filter((d) => !known.has(key(d.title)));
  console.log(`${items.length} items, ${items.length - todo.length} already known, ${todo.length} to fetch`);

  let done = 0;
  let got = 0;
  const next = async () => {
    for (;;) {
      const item = todo.shift();
      if (!item) return;
      try {
        const files = ((await json(`https://archive.org/metadata/${item.identifier}/files`)) || {}).result || [];
        const milk = files.find((f) => f.name.toLowerCase().endsWith('.milk'));
        if (milk) {
          const res = await fetch(`https://archive.org/download/${item.identifier}/${encodeURIComponent(milk.name)}`);
          if (res.ok) {
            const name = String(item.title).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 180);
            fs.writeFileSync(path.join(out, `${name}.milk`), Buffer.from(await res.arrayBuffer()));
            got += 1;
          }
        }
      } catch {
        // et enkelt emne, der fejler, springes over
      }
      done += 1;
      if (done % 200 === 0) console.log(`${done} done, ${got} presets`);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, next));
  console.log(`Done: ${got} new presets in ${out}`);
})();
