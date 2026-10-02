'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FlashGuard, FLASH_GUARD_DEFAULTS } = require('../src/shared/flash-guard');

// Sløjfen fanger tegnefejl og skriver dem som advarsler; testene skal se dem (se sidste test).
const warnings = [];
console.warn = (...args) => warnings.push(args.map(String).join(' '));

// Et falsk 2D-lærred: alle tegnekald accepteres, gradienter har addColorStop.
function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

global.window = { devicePixelRatio: 1, VisampBandDrive: require('../src/shared/band-drive') };
let frames = [];
global.requestAnimationFrame = (fn) => frames.push(fn);
require('../src/renderer/tron-overlay.js');
const { TronOverlay } = global.window.Visamp;

function makeOverlay() {
  const canvas = { width: 0, height: 0, hidden: true, getContext: () => fakeContext(), getBoundingClientRect: () => ({ width: 1280, height: 720 }) };
  return { canvas, overlay: new TronOverlay(canvas) };
}

/** Kører sløjfen i `seconds` med 60 billeder i sekundet. `each(t)` kaldes før hvert billede (t i sekunder). */
function runFrames(seconds, t0 = 0, each = null) {
  let t = t0;
  for (let i = 0; i < seconds * 60; i++) {
    t += 1000 / 60;
    if (each) each(t / 1000);
    const pending = frames;
    frames = [];
    for (const fn of pending) fn(t);
  }
  return t;
}

const STATE = { silent: false, energy: 'mid', building: false, buildStart: null };

/**
 * Lydtræk som FeatureExtractor og motorens kick-onset: kick på hvert slag (henfald 60 ms), hi-hats på sekstendedele,
 * mellemtonen i `midLevel` gange det normale.
 */
function music(t, { bpm = 120, kick = true, hats = true, midLevel = 1 } = {}) {
  const beat = 60 / bpm;
  const sinceKick = t % beat;
  const sinceHat = t % (beat / 4);
  const kickAmp = kick ? 0.02 + Math.exp(-sinceKick / 0.06) : 0.02;
  const trebAmp = 0.01 + (hats ? 0.3 * Math.exp(-sinceHat / 0.02) : 0);
  return {
    f: { kick: kickAmp * kickAmp, mid: 0.04 * midLevel * midLevel, treb: trebAmp * trebAmp, trebFlux: hats && sinceHat < 1 / 60 ? 4 : 0.05 },
    kickOnset: kick && sinceKick < 1 / 60 ? 6 : 0.3,
  };
}

/** Fodrer laget med musik hvert billede (som musicLoop i app.js). */
function driver(overlay, opts = {}, state = STATE) {
  return (t) => {
    const { f, kickOnset } = music(t, opts);
    overlay.drive(t, f, typeof state === 'function' ? state(t) : state, kickOnset);
  };
}

test('Tron-laget tegner gulv, slag, lyscykler, ny del og derez uden fejl', () => {
  frames = [];
  const { canvas, overlay } = makeOverlay();
  overlay.setEnabled(true);
  assert.equal(canvas.hidden, false);
  let t = runFrames(1);
  assert.ok(overlay.visibility > 0.9, 'toner ind');
  overlay.beat({ downbeat: true, bpm: 128 });
  assert.equal(overlay.bpm, 128);
  assert.ok(overlay.pulse >= 1);
  overlay.event('drop');
  assert.ok(overlay.cycles.length >= 3, 'lyscykler på droppet');
  overlay.event('section');
  overlay.event('cut');
  t = runFrames(0.5, t);
  assert.ok(overlay.derez === 0, 'derez-glimtet er kort');
  assert.ok(overlay.cycles.some((c) => c.trail.length > 10), 'lyscyklerne kører og trækker en lysvæg');
  t = runFrames(6, t);
  assert.equal(overlay.cycles.length, 0, 'lyscyklerne er væk igen');
});

test('slået fra toner laget ud og skjules, og hændelser ignoreres', () => {
  frames = [];
  const { canvas, overlay } = makeOverlay();
  overlay.setEnabled(true);
  let t = runFrames(1);
  overlay.setEnabled(false);
  t = runFrames(3, t);
  assert.equal(canvas.hidden, true);
  assert.equal(frames.length, 0, 'sløjfen er stoppet');
  overlay.event('drop');
  assert.equal(overlay.cycles.length, 0);
  // Bånd-drevet kører videre (varme gennemsnit), men tegner og glimter ikke.
  let hats = 0;
  for (let i = 1; i <= 120; i++) {
    driver(overlay)(10 + i / 60);
    if (overlay.bands.hatHit) hats += 1;
  }
  assert.ok(hats > 10, 'hi-hats høres');
  assert.equal(overlay.glintNodes.length, 0);
  assert.equal(frames.length, 0);
});

test('rigtige kicks driver gulvet og horisonten; den forudsagte takt er kun reserven', () => {
  frames = [];
  const { overlay } = makeOverlay();
  overlay.setEnabled(true);
  // Uden bånd-drev: slaget fra takten lyser gulvet op som før.
  overlay.beat({ downbeat: true, bpm: 120 });
  assert.ok(overlay.pulse >= 1);
  let t = runFrames(2);
  assert.ok(overlay.pulse < 0.01);
  // Med musik: gulvet følger kick-båndet, horisonten de rigtige kicks, og takten tænder ikke gulvet.
  const lights = [];
  const horizon = [];
  t = runFrames(8, t, (s) => {
    driver(overlay)(s);
    lights.push(overlay.floorLight());
    horizon.push(overlay.bands.horizon);
  });
  assert.ok(overlay.bands.realKicks);
  overlay.beat({ downbeat: false, bpm: 120 });
  assert.ok(overlay.pulse < 0.01, 'takten tænder ikke gulvet, når der høres kicks');
  const recent = lights.slice(-120);
  assert.ok(Math.max(...recent) > 0.85, `gulvet lyser på kicket: ${Math.max(...recent)}`);
  assert.ok(Math.min(...recent) < 0.6, `og falder imellem: ${Math.min(...recent)}`);
  assert.ok(Math.max(...horizon.slice(-120)) > 0.8 && Math.min(...horizon.slice(-120)) < 0.15, 'horisonten lyser på kickene og falder imellem');
  // Kicks hører op: efter realKicksSec er takten reserven igen.
  t = runFrames(2.5, t, driver(overlay, { kick: false }));
  assert.equal(overlay.bands.realKicks, false);
  overlay.beat({ downbeat: true, bpm: 120 });
  assert.ok(overlay.pulse >= 1);
});

/** Hvor langt en lyscykel (fart 8, ingen drejning) kører på 0,25 s, når mellemtonen er `midLevel` gange det normale. */
function cycleRun(midLevel) {
  frames = [];
  const { overlay } = makeOverlay();
  overlay.setEnabled(true);
  let t = runFrames(10, 0, driver(overlay));
  t = runFrames(0.6, t, driver(overlay, { midLevel }));
  overlay.spawnCycle(0);
  const c = overlay.cycles[overlay.cycles.length - 1];
  c.turnAt = null;
  c.speed = 8;
  const x0 = c.x;
  runFrames(0.25, t, driver(overlay, { midLevel }));
  return { overlay, distance: Math.abs(c.x - x0) };
}

test('mellemtonen styrer lyscyklernes fart og spor, hi-hats glimter i knuderne', () => {
  const normal = cycleRun(1);
  assert.ok(Math.abs(normal.overlay.midGain(0.5) - 1) < 0.02, 'normal mellemtone: som før');
  assert.ok(Math.abs(normal.distance - 8 * 0.25) < 0.1, `${normal.distance}`);
  const loud = cycleRun(2.5);
  const quiet = cycleRun(0.3);
  assert.ok(loud.overlay.midGain(0.6) > 1.15, `kraftig mellemtone: klarere og bredere spor (${loud.overlay.midGain(0.6)})`);
  assert.ok(quiet.overlay.midGain(0.6) < 0.85);
  assert.ok(loud.distance > normal.distance && normal.distance > quiet.distance);
  assert.ok(loud.distance > quiet.distance * 1.3, `${loud.distance} mod ${quiet.distance}`);
  // Hi-hats: knuder i gitteret glimter og er væk på under 0,2 s, når hi-hats holder op.
  const { overlay } = loud;
  assert.ok(overlay.glintNodes.length > 0);
  for (const node of overlay.glintNodes) assert.ok(Number.isInteger(node.row) && Math.abs(node.x) <= 9);
  runFrames(0.2, 20000, driver(overlay, { hats: false, kick: false }));
  assert.ok(overlay.bands.glint < 0.05 && overlay.bands.treb < 0.1);
});

test('en opbygning løfter intensitet og mætning glat, uden spring', () => {
  frames = [];
  const { overlay } = makeOverlay();
  overlay.setEnabled(true);
  let t = runFrames(10, 0, driver(overlay, {}, { ...STATE, energy: 'low' }));
  const before = overlay.intensity;
  assert.ok(before < 0.8 && overlay.saturation < 0.7, `stille del: ${before}, ${overlay.saturation}`);
  const samples = [];
  t = runFrames(12, t, (s) => {
    driver(overlay, {}, { ...STATE, energy: 'low', building: true, buildStart: 10 })(s);
    samples.push(overlay.intensity);
  });
  assert.ok(overlay.intensity > 1.05, `toppen af opbygningen: ${overlay.intensity}`);
  assert.ok(overlay.saturation > 0.9);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] >= samples[i - 1] - 1e-9, 'stiger hele vejen');
    assert.ok(samples[i] - samples[i - 1] < 0.01, 'og glat');
  }
});

test('laget holder sig under blink-vagtens grænse, også ved 180 BPM med sekstendedels-hi-hats', () => {
  frames = [];
  const { overlay } = makeOverlay();
  overlay.setEnabled(true);
  // Blink-vagten måler kun MilkDrops billede. Her fodres den med lyset på lagets store flader, som om de fyldte hele
  // skærmen (de fylder langt mindre), hvert andet billede som i visualizer.js.
  const guard = new FlashGuard();
  let n = 0;
  let tripped = false;
  const light = [];
  runFrames(30, 0, (s) => {
    driver(overlay, { bpm: 180, midLevel: 1.5 }, { ...STATE, energy: 'high' })(s);
    if (++n % 2 === 0) {
      light.push(overlay.floorLight());
      if (guard.feed(s, overlay.floorLight())) tripped = true;
    }
  });
  assert.equal(tripped, false);
  // ... og med god afstand: vagten slår til ved 55 % spring.
  const steady = light.slice(300);
  let jumps = 0;
  for (let i = 1; i < steady.length; i++) if (Math.abs(steady[i] - steady[i - 1]) > FLASH_GUARD_DEFAULTS.jump) jumps += 1;
  assert.ok(jumps / (steady.length - 1) < 0.4, `${Math.round((100 * jumps) / (steady.length - 1))} % spring`);
  assert.ok(Math.max(...steady) - Math.min(...steady) > 0.3, 'gulvet pulserer stadig tydeligt');
  // Testen skelner: et gulv, der tænder og slukker hvert andet billede, ville slå vagten.
  const strobe = new FlashGuard();
  let strobed = false;
  for (let i = 0; i < 30 * 30; i++) if (strobe.feed(i / 30, i % 2 ? 0.45 : 1)) strobed = true;
  assert.ok(strobed);
});

test('en fejl i bånd-drevet stopper kun bånd-drevet og står i konsollen', () => {
  frames = [];
  const { overlay } = makeOverlay();
  overlay.setEnabled(true);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    overlay.drive(1, { kick: 1, mid: 1, treb: 1 }, STATE, 0);
    overlay.drive(1.1, { kick: 1, mid: 1, treb: 1 }, STATE, 0);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /trebFlux/);
  assert.equal(overlay.driveBroken, true);
  overlay.beat({ downbeat: true, bpm: 120 });
  assert.ok(overlay.pulse >= 1, 'hændelserne virker stadig');
  runFrames(0.5);
});

test('ingen tegnefejl i nogen af testene (sløjfen ville kun advare)', () => {
  assert.deepEqual(warnings, []);
});
