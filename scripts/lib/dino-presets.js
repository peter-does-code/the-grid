/*
 * Dinosaurer i presets (Jurassic Grid, 07-10-2026). En silhuet (PhyloPic, CC0; `data/dino/<art>.json`, lavet af
 * presets-work/dino/outline-fourier.js) er gemt som Fourier-koefficienter: x(t) og y(t) som summer af sinus og cosinus.
 * En custom wave i presettet tegner omridset punkt for punkt, så presettets egen warp og feedback smører dinosauren
 * ud i sin egen stil. Intet lægges ovenpå billedet.
 *
 * To måder:
 * - `focusWave`: en blød klat (7 harmoniske) i ro, der kommer i fokus som dinosaur, når bassen stiger over sangens eget
 *   løbende gennemsnit; slipper igen over cirka 2,5 s. Bruges i frie wave-pladser i rolige presets.
 * - `dinoFern`: bregnen (Flexi - oldschool tree): frølinjen, som presettets kopier bygger bladene af, erstattes af en
 *   T. rex, og kopierne dæmpes, så bregnen bliver en stak dinosaurer.
 *
 * Butterchurn-detaljer: custom wave-koordinater er kvadratiske (1 enhed = skærmens bredde), y vokser opad, synligt y er
 * 0,22-0,78; t1-t8 nulstilles hver frame, egne variable (pres, avg) bevares.
 */
'use strict';

const f = (v) => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(6));

/** Punktligninger, der lægger omridset i a['xs'], a['ys'] (bredde 1, centreret, y op), lavpasset efter a['t5']. */
function outlineEqs(C, { focus = true } = {}) {
  let s = `a['ph']=6.283185307*a['sample']; a['xs']=${f(C.ax[0])}; a['ys']=${f(C.ay[0])};`;
  for (let k = 1; k <= C.harmonics; k++) {
    const w = focus ? `a['w']=Math.exp(-Math.pow(${k}/a['t5'],4)); ` : `a['w']=1; `;
    s += ` ${w}a['c']=Math.cos(${k}*a['ph']); a['s']=Math.sin(${k}*a['ph']);`;
    s += ` a['xs']+=a['w']*(${f(C.ax[k])}*a['c']+${f(C.bx[k])}*a['s']);`;
    s += ` a['ys']+=a['w']*(${f(C.ay[k])}*a['c']+${f(C.by[k])}*a['s']);`;
  }
  return s;
}

/** Bredden, så figuren højst er `maxH` skærmbredder høj (synlig højde er 0,5625). */
const fitWidth = (C, width, maxH) => Math.min(width, maxH / C.aspect);

/**
 * Klat-til-dinosaur-bølgerne (1-3 passager) til frie wave-pladser. Tilstanden (pres, avg) ligger i egne variable.
 * @returns {object[]} waves, den første er hovedlinjen, de næste svage kopier for vægt og glød
 */
function focusWave(C, { width = 0.62, cx = 0.5, cy = 0.52, color = [1, 0.5, 0.08], flipY = false, alphaMin = 0.4, passes = 2 } = {}) {
  // Meget brede arter (diplodocus, triceratops) må fylde mere, ellers bliver de små og lave.
  const w = fitWidth(C, C.aspect < 0.4 ? Math.max(width, 0.82) : width, 0.42);
  const frame = [
    `a['avg']=a['avg']<0.2?a['bass_att']:a['avg']*0.996+0.004*a['bass_att'];`,
    `a['hit']=Math.min(1,Math.max(0,(a['bass_att']/a['avg']-1.0)*5)); a['pres']=Math.max(a['pres']*0.975,a['hit']);`,
    `a['t1']=a['pres'];`,
    `a['t6']=0.5+0.5*Math.sin(a['time']*0.6);`,
    `a['t2']=${f(w)}*(1+0.03*a['t6']+0.05*Math.max(0,a['bass']-1));`,
    `a['t3']=${f(cx)}+0.025*Math.sin(a['time']*0.19); a['t4']=${f(cy)}+0.015*Math.sin(a['time']*0.27);`,
    `a['t5']=7+${f(C.harmonics * 1.1 - 7)}*Math.pow(a['t1'],1.2);`,
    `a['t7']=${f(alphaMin)}+${f(1 - alphaMin)}*a['t1'];`,
  ].join(' ');
  const place = (k) => ` a['x']=a['t3']+a['t2']*${f(k)}*a['xs']; a['y']=a['t4']${flipY ? '-' : '+'}a['t2']*${f(k)}*a['ys'];`;
  const point = (k) =>
    outlineEqs(C) + place(k) + ` a['r']=${f(color[0])}; a['g']=${f(color[1])}+0.1*Math.sin(a['ph']+a['time']*0.3); a['b']=${f(color[2])}; a['a']=a['t7'];`;
  const base = { enabled: 1, samples: 512, sep: 0, scaling: 1, smoothing: 0.4, r: color[0], g: color[1], b: color[2], a: 1, spectrum: 0, usedots: 0, thick: 1, additive: 1 };
  const wave = (k, a) => ({ baseVals: { ...base, a }, init_eqs_str: `a['pres']=0; a['avg']=0;`, frame_eqs_str: frame, point_eqs_str: point(k) });
  const waves = [wave(1, 1), wave(1.005, 0.5), wave(0.995, 0.6)];
  return waves.slice(0, Math.max(1, Math.min(3, passes)));
}

/** Lægger klat-til-dinosaur-bølgerne i presettets frie wave-pladser. Returnerer en kopi, eller null uden fri plads. */
function withDino(preset, C, opts = {}) {
  const p = JSON.parse(JSON.stringify(preset));
  const free = p.waves.map((w, i) => (w.baseVals.enabled ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return null;
  focusWave(C, opts).forEach((wv, i) => {
    if (free[i] !== undefined) p.waves[free[i]] = wv;
  });
  return p;
}

/**
 * Bregnen (Flexi - oldschool tree) med en T. rex som frø: wave 1 tegnede en linje, som presettets teksturerede figurer
 * kopierer formindsket og drejet (bregnen er den fraktal, kopierne konvergerer mod, uanset frøet). Frøet bliver en
 * dinosaur, og kopierne dæmpes (a2), så kun få generationer ses, hver som en dinosaur.
 */
function dinoFern(preset, C) {
  const p = JSON.parse(JSON.stringify(preset));
  for (const i of [1, 2]) p.shapes[i].baseVals.a2 = 0.55;
  p.shapes[3].baseVals.a2 = 0.6;
  const w = p.waves[1];
  w.baseVals.samples = 512;
  w.baseVals.smoothing = 0.3;
  Object.assign(w.baseVals, { r: 0.9, g: 0.72, b: 0.28, a: 1, additive: 1 });
  const point = (sc) =>
    outlineEqs(C, { focus: false }) +
    // Samme svaj som den oprindelige frølinje (ox og q2), stående på den nederste kant, zoomet som originalen (q10/q11,
    // som vender y, derfor minus).
    ` a['ox']=((a['q4']-0.5)*0.2); a['cx']=0.5+a['ox']+Math.sin(a['q2'])*0.1; a['cy']=0.655;` +
    ` a['sc']=${f(sc)}+0.03*Math.sin(a['time']*0.7);` +
    ` a['x']=a['cx']+a['sc']*a['xs']; a['y']=a['cy']-a['sc']*a['ys'];` +
    ` a['x']=(0.5+div((a['x']-0.5),a['q10'])); a['y']=(0.5+div((a['y']-0.5),a['q11']));`;
  w.point_eqs_str = point(0.5);
  // En anden, lidt større og svagere passage i den frie wave 0, så omridset overlever kopieringen.
  p.waves[0] = { ...w, baseVals: { ...w.baseVals, a: 0.7 }, point_eqs_str: point(0.508) };
  return p;
}

module.exports = { outlineEqs, focusWave, withDino, dinoFern };
