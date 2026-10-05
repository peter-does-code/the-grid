'use strict';

/*
 * Konverterer MilkDrop-presets (.milk) til Butterchurns format:
 *
 *   node scripts/convert-presets.js <mappe med .milk-filer> <ud-mappe> [--per-style=20] [--workers=4]
 *
 * Mappen er typisk "Cream of the Crop" (projectM, ca. 9.700 presets sorteret i stilarter som
 * Reaction/Liquid Ripples). Med --per-style udtages højst så mange fra hver stilart (fast tilfældig
 * rækkefølge), så de ca. 200 stilarter alle er med, uden at alle 9.700 skal konverteres og testes.
 * Mappen "! Transition" (overgange til sort) springes over, og af næsten ens remix (fx 266 udgaver af
 * "Royal - Mashup") tages højst 2.
 *
 * Hver .milk-fil bliver til en .json-fil i ud-mappen, og manifest.json beskriver dem (navn, stilart,
 * størrelse, fejl). Næste trin er `--presettest`, der tegner hvert preset, og scripts/build-preset-pack.js,
 * der vælger de bedste.
 *
 * Konverteren (milkdrop-preset-converter, MIT, af Butterchurns forfatter) er ren JavaScript: ligningerne
 * oversættes fra EEL til JavaScript og shaderne fra HLSL til GLSL. Den er langsom (ca. 1 preset i sekundet),
 * så arbejdet deles ud på flere processer.
 */
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { repairShader } = require('./lib/repair-shader');
const { repairEel } = require('./lib/repair-eel');
const { shaderOverride } = require('./lib/shader-overrides');
const { hlslToGlsl } = require('./lib/hlsl-to-glsl');

const MAX_BYTES = 200 * 1024; // unormalt store filer (typisk indlejrede billeder) springes over
let PER_FAMILY = 2; // --per-family=<n> (Infinity = alle, fx Winamp-klassikerne)

function walk(dir, list = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, list);
    else if (name.toLowerCase().endsWith('.milk')) list.push(p);
  }
  return list;
}

/** Remix-familie: navnet uden løbenummer, fx "$$$ Royal - Mashup (257)" → "royal - mashup". */
function family(name) {
  return name
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s*[-_ ]\s*\d+[a-z]?\s*$/i, '')
    .replace(/^[$!@#\s]+/, '')
    .toLowerCase()
    .trim();
}

function seededShuffle(list, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function select(src, perStyle) {
  const byStyle = new Map();
  for (const file of walk(src)) {
    const rel = path.relative(src, file).split(path.sep);
    if (rel[0].startsWith('!')) continue;
    const style = rel.slice(0, Math.min(2, rel.length - 1)).join('/');
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style).push(file);
  }
  const families = new Map();
  const chosen = [];
  for (const [style, files] of [...byStyle].sort((a, b) => a[0].localeCompare(b[0]))) {
    let taken = 0;
    for (const file of seededShuffle(files.sort(), 12345)) {
      if (taken >= perStyle) break;
      const fam = family(path.basename(file, '.milk'));
      if ((families.get(fam) || 0) >= PER_FAMILY) continue;
      families.set(fam, (families.get(fam) || 0) + 1);
      chosen.push({ file, style });
      taken += 1;
    }
  }
  return chosen;
}

async function convertOne(src, out, { file, style }) {
  const { convertPreset } = require('milkdrop-preset-converter');
  const rel = path.relative(src, file);
  const entry = { name: path.basename(file, path.extname(file)), style, file: rel.replace(/\.milk$/i, '.json').split(path.sep).join('/') };
  try {
    // Ligninger, parseren afviser (unært plus, scripts/lib/repair-eel.js), rettes før konverteringen.
    const text = repairEel(fs.readFileSync(file, 'latin1'));
    if (text.length > MAX_BYTES) throw new Error('too large');
    const preset = await convertPreset(text);
    // Konverterens shadere har kendte fejl, der giver sorte presets (se scripts/lib/repair-shader.js).
    preset.warp = repairShader(preset.warp, 'warp');
    preset.comp = repairShader(preset.comp, 'comp');
    // Håndoversatte shadere, hvor konverteren mister operatorer (scripts/lib/shader-overrides.js).
    const override = shaderOverride(entry.name);
    if (override) Object.assign(preset, override);
    // --alt-shaders: vores egen oversættelse af pixel-shaderne i stedet for konverterens (scripts/lib/hlsl-to-glsl.js).
    // Preset-testen afgør bagefter, hvilken udgave der virker (scripts/pick-shaders.js).
    else if (process.env.GRID_ALT_SHADERS === '1') {
      for (const kind of ['warp', 'comp']) {
        const alt = hlslToGlsl(text, kind, preset[kind]);
        if (alt) preset[kind] = alt;
      }
    }
    const json = JSON.stringify(preset);
    const target = path.join(out, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
    entry.bytes = json.length;
  } catch (err) {
    entry.error = String((err && err.message) || err).slice(0, 200);
  }
  return entry;
}

// Arbejderproces: får en liste og melder hvert resultat tilbage.
if (process.argv[2] === '--worker') {
  process.on('message', async ({ src, out, jobs }) => {
    for (const job of jobs) process.send(await convertOne(src, out, job));
    process.exit(0);
  });
} else {
  const args = process.argv.slice(2);
  const [src, out] = args.filter((a) => !a.startsWith('--'));
  const opt = (name, def) => {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    return a ? Number(a.split('=')[1]) : def;
  };
  if (!src || !out) {
    console.error('Brug: node scripts/convert-presets.js <mappe med .milk-filer> <ud-mappe> [--per-style=20] [--workers=4]');
    process.exit(1);
  }
  PER_FAMILY = opt('per-family', PER_FAMILY);
  if (args.includes('--alt-shaders')) process.env.GRID_ALT_SHADERS = '1'; // arves af arbejderprocesserne
  const jobs = select(src, opt('per-style', Infinity));
  const workers = Math.max(1, opt('workers', 4));
  const manifest = [];
  const started = Date.now();
  console.log(`${jobs.length} presets fra ${new Set(jobs.map((j) => j.style)).size} stilarter, ${workers} processer`);
  let running = workers;
  for (let w = 0; w < workers; w++) {
    const child = fork(__filename, ['--worker'], { execArgv: ['--max-old-space-size=4096'] });
    child.on('message', (entry) => {
      manifest.push(entry);
      if (manifest.length % 100 === 0) {
        const ok = manifest.filter((m) => !m.error).length;
        console.log(`${manifest.length}/${jobs.length} (${ok} ok, ${Math.round((Date.now() - started) / 1000)} s)`);
      }
    });
    child.on('exit', () => {
      if (--running > 0) return;
      fs.mkdirSync(out, { recursive: true });
      manifest.sort((a, b) => a.file.localeCompare(b.file));
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
      const ok = manifest.filter((m) => !m.error).length;
      console.log(`Færdig: ${ok} af ${jobs.length} konverteret til ${out} (${Math.round((Date.now() - started) / 1000)} s)`);
    });
    child.send({ src, out, jobs: jobs.filter((_, i) => i % workers === w) });
  }
}
