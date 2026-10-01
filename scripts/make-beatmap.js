'use strict';

/*
 * Laver beat-kortet til påskeægget "drew" ud fra musiktestens analyse af Init:
 *
 *   node scripts/start.js --musictest --file=src/renderer/media/init.mp3 > init-analysis.json
 *   node scripts/make-beatmap.js init-analysis.json
 *
 * Musikmotoren skal høre sig frem til takten live, og i Init låser den først omkring 18 s (før det hører
 * den bassens mønster som 62 BPM). Kendes sangen på forhånd, kan showet i stedet slå på de målte slag
 * ud fra sangens egen tid. Kortet har to dele:
 *   START → ONSETS_UNTIL   de faktiske bas-slag, fundet i bassens kurve. Første hørbare slag er ved 10,45 s,
 *                          og mellem 11,4 og 14 s spiller bassen på bagslaget, så et fast gitter ville
 *                          slå ved siden af. Hvert slag rykkes til nærmeste halve slag i gitteret, hvis
 *                          det ligger inden for 60 ms.
 *   ONSETS_UNTIL →         det faste gitter. Tempoet driver lidt gennem sangen, så hvert slag glattes
 *                          mod sine naboer (lokal lineær tilpasning).
 * Resultatet skrives til src/renderer/media/init-beats.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const START = 10.3; // første hørbare bas-slag er ved 10,45 s (fadeEnd i drew.js). Bassen svulmer op ved 8,5 og 9,5 s, men det er ikke slag.
const ONSETS_UNTIL = 14.2; // herfra følger bassen gitteret igen
const STABLE_FROM = 18; // herfra har motoren låst takten
const WINDOW = 8; // naboslag på hver side i den lokale tilpasning
const END = Infinity; // hele sangen: showet kører, til Init er færdig

const input = process.argv[2];
if (!input) {
  console.error('Brug: node scripts/make-beatmap.js <musiktest-output.json>');
  process.exit(1);
}
const text = fs.readFileSync(input, 'utf8');
const report = JSON.parse(text.slice(text.indexOf('{')));
const beats = report.beatTimes.filter((b) => b.t >= STABLE_FROM);

function fitLine(points) {
  const n = points.length;
  const sx = points.reduce((a, p) => a + p[0], 0);
  const sy = points.reduce((a, p) => a + p[1], 0);
  const sxx = points.reduce((a, p) => a + p[0] * p[0], 0);
  const sxy = points.reduce((a, p) => a + p[0] * p[1], 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope, intercept: (sy - slope * sx) / n };
}

// Globalt gitter: slagnummer n for hvert målt slag.
const intervals = beats.slice(1).map((b, i) => b.t - beats[i].t).sort((a, b) => a - b);
let period = intervals[Math.floor(intervals.length / 2)];
let t0 = beats[0].t;
for (let i = 0; i < 3; i++) {
  const fit = fitLine(beats.map((b) => [Math.round((b.t - t0) / period), b.t]));
  period = fit.slope;
  t0 = fit.intercept;
}
const numbered = new Map();
for (const b of beats) {
  const n = Math.round((b.t - t0) / period);
  if (Math.abs(b.t - (t0 + n * period)) < period * 0.3) numbered.set(n, b.t);
}
const ns = [...numbered.keys()].sort((a, b) => a - b);
const lastN = ns[ns.length - 1];
const firstN = Math.ceil((START - t0) / period);
const endN = Math.min(lastN, Math.floor((END - t0) / period));

/** Lokal tilpasning uden afvigere: slag, der ligger mere end 50 ms fra linjen, tæller ikke med. */
function robustFit(points) {
  let use = points;
  let fit = fitLine(use);
  for (let i = 0; i < 3; i++) {
    const kept = use.filter(([n, t]) => Math.abs(t - (fit.intercept + fit.slope * n)) < 0.05);
    if (kept.length < 4 || kept.length === use.length) break;
    use = kept;
    fit = fitLine(use);
  }
  return fit;
}

// Hvert slag: lokal lineær tilpasning over naboerne (udfylder også slag, motoren sprang over).
const out = [];
for (let n = firstN; n <= endN; n++) {
  const near = ns.filter((m) => Math.abs(m - Math.max(n, ns[0])) <= WINDOW).map((m) => [m, numbered.get(m)]);
  const fit = robustFit(near.length >= 4 ? near : ns.slice(0, 2 * WINDOW).map((m) => [m, numbered.get(m)]));
  out.push({ n, t: fit.intercept + fit.slope * n });
}

// Taktstart: den fase (n mod 4), motoren oftest kaldte taktstart i den stabile del.
const votes = [0, 0, 0, 0];
for (const b of beats) {
  if (!b.down) continue;
  const n = Math.round((b.t - t0) / period);
  votes[((n % 4) + 4) % 4] += 1;
}
const downPhase = votes.indexOf(Math.max(...votes));

// Bas-slagene i starten: toppe i bassens stigning (glattet over 50 ms), mindst 0,3 s imellem.
const bass = report.bassFine;
const smooth = bass.map((v, i) => {
  let sum = 0;
  let n = 0;
  for (let j = i - 2; j <= i + 2; j++) if (bass[j] !== undefined) (sum += bass[j]), n++;
  return sum / n;
});
const rise = smooth.map((v, i) => (smooth[i + 3] ?? v) - (smooth[i - 3] ?? v));
const onsets = [];
for (let i = Math.round(START * 100); i < Math.round(ONSETS_UNTIL * 100); i++) {
  if (rise[i] > 3 && rise[i] >= rise[i - 1] && rise[i] >= rise[i + 1]) {
    const t = i / 100;
    const last = onsets[onsets.length - 1];
    if (!last || t - last.t > 0.3) onsets.push({ t, rise: rise[i] });
    else if (rise[i] > last.rise) onsets[onsets.length - 1] = { t, rise: rise[i] };
  }
}
const half = period / 2;
const early = onsets.map(({ t }) => {
  const snapped = t0 + Math.round((t - t0) / half) * half;
  return Math.abs(snapped - t) < 0.06 ? snapped : t;
});

const grid = out.filter((b) => b.t >= ONSETS_UNTIL);
const times = [...early, ...grid.map((b) => b.t)].map((t) => Math.round(t * 1000) / 1000);
// Taktstarter: det første bas-slag (Drews entré) og gitterets taktstarter.
const downbeats = [0, ...grid.map((b, i) => (((b.n % 4) + 4) % 4 === downPhase ? early.length + i : -1)).filter((i) => i >= 0)];
const target = path.join(__dirname, '..', 'src', 'renderer', 'media', 'init-beats.js');
const body = `/*
 * Beat-kort til "Init" (Nine Inch Nails), lavet af scripts/make-beatmap.js ud fra musiktestens analyse.
 * Rediger ikke i hånden; kør scriptet igen, hvis sangen skiftes. Tider i sekunder inde i sangen.
 * Tempo ca. ${(60 / period).toFixed(2)} BPM, ${times.length} slag fra ${times[0]} til ${times[times.length - 1]} s.
 */
(function () {
  'use strict';
  window.Visamp = window.Visamp || {};
  window.Visamp.INIT_BEATS = {
    beats: ${JSON.stringify(times)},
    downbeats: ${JSON.stringify(downbeats)},
  };
})();
`;
fs.writeFileSync(target, body);
console.log(`Skrev ${times.length} slag (${early.length} bas-slag fra ${times[0]} s, derefter gitter ${(60 / period).toFixed(2)} BPM) til ${target}`);
