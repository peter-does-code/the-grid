'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MusicEngine, PresetDirector, FeatureExtractor, profilePreset, scorePreset } = require('../src/shared/music-engine.js');

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Simulerer lydtræk ved 60 billeder/s. `parts` beskriver sangens dele: lydstyrke (dBFS), fordeling
 * mellem bas/mellemtone/diskant, og om der er slag. Slag ligger på firstBeat + k * 60/bpm.
 */
function simulate({ seconds, bpm = 128, firstBeat = 0.25, parts, accentEvery = 0, fps = 60, seed = 7, options = {} }) {
  const engine = new MusicEngine({ onsetLatency: 0, ...options });
  const rnd = seeded(seed);
  const period = 60 / bpm;
  const events = [];
  const partsList = parts || [{ from: 0, to: seconds, loud: -20, shares: [0.6, 0.3, 0.1], beats: true }];
  for (let k = 0; k / fps < seconds; k++) {
    const t = k / fps;
    const part = partsList.find((p) => t >= p.from && t < p.to) || partsList[partsList.length - 1];
    // Opbygning: lydstyrken glider fra loud til loudTo, og slagene deles op (subdivTo: 2 = ottendedele,
    // 4 = sekstendedele) i løbet af delen, som en trommehvirvel før et drop.
    const progress = part.to > part.from ? Math.min(1, Math.max(0, (t - part.from) / (part.to - part.from))) : 0;
    const loud = part.loudTo === undefined ? part.loud : part.loud + (part.loudTo - part.loud) * progress;
    const subdiv = part.subdivTo ? Math.pow(2, Math.floor(progress * Math.log2(part.subdivTo) + 1e-9)) : 1;
    // En del kan have sit eget tempo (part.bpm), med slag fra delens start.
    const pPeriod = part.bpm ? 60 / part.bpm : period;
    const origin = part.bpm ? part.from : firstBeat;
    const n = Math.floor((t - origin) / pPeriod);
    const beatAt = origin + n * pPeriod;
    const subPeriod = pPeriod / subdiv;
    const subAt = origin + Math.floor((t - origin) / subPeriod) * subPeriod;
    const onBeat = part.beats && t >= origin && (t - beatAt < 1 / fps || (subdiv > 1 && t - subAt < 1 / fps));
    const accent = accentEvery && n % accentEvery === 0 ? 1.6 : 1;
    const silent = part.silent;
    const level = silent ? 0 : Math.pow(10, loud / 20) * (onBeat ? 1.3 : 1);
    const energy = level * level;
    const f = {
      rms: level,
      rmsDb: 20 * Math.log10(level + 1e-9),
      bass: energy * (part.shares ? part.shares[0] : 0),
      mid: energy * (part.shares ? part.shares[1] : 0),
      treb: energy * (part.shares ? part.shares[2] : 0),
      flux: silent ? 0 : onBeat ? 3 * accent : 0.2 + 0.1 * rnd(),
      kickFlux: silent ? 0 : onBeat ? 2 * accent : 0.05 * rnd(),
    };
    for (const e of engine.update(t, f)) events.push({ ...e, emittedAt: t });
  }
  const trueBeats = (from, to) => {
    const out = [];
    for (let b = firstBeat; b < to; b += period) if (b >= from) out.push(b);
    return out;
  };
  return { engine, events, period, trueBeats, firstBeat };
}

function beatErrors(result, from, to) {
  const { events, period, firstBeat } = result;
  return events
    .filter((e) => e.type === 'beat' && e.t >= from && e.t < to)
    .map((e) => {
      const k = Math.round((e.t - firstBeat) / period);
      return e.t - (firstBeat + k * period);
    });
}

for (const bpm of [90, 128, 150]) {
  test(`finder tempoet ${bpm} BPM og rammer slagene`, () => {
    const result = simulate({ seconds: 16, bpm });
    const state = result.engine.state;
    assert.ok(state.tempoValid, 'tempoet er fundet');
    assert.ok(Math.abs(state.bpm - bpm) < 1.5, `målt ${state.bpm.toFixed(2)} BPM`);
    const errors = beatErrors(result, 8, 16);
    assert.ok(errors.length >= Math.floor((8 * bpm) / 60) - 2, `${errors.length} slag udsendt`);
    const within = errors.filter((e) => Math.abs(e) <= 0.04).length / errors.length;
    assert.ok(within >= 0.9, `${Math.round(within * 100)} % af slagene inden for 40 ms`);
  });
}

test('accent på hvert andet slag giver ikke halvt tempo', () => {
  const result = simulate({ seconds: 16, bpm: 128, accentEvery: 2 });
  assert.ok(Math.abs(result.engine.state.bpm - 128) < 1.5, `målt ${result.engine.state.bpm}`);
});

test('taktens første slag findes ud fra de kraftigste slag', () => {
  const result = simulate({ seconds: 20, bpm: 120, accentEvery: 4 });
  const late = result.events.filter((e) => e.type === 'beat' && e.t > 12);
  const downbeats = late.filter((e) => e.downbeat);
  assert.ok(downbeats.length >= 2);
  for (const e of downbeats) {
    const k = Math.round((e.t - result.firstBeat) / result.period);
    assert.equal(k % 4, 0, `slag ${k} markeret som taktens første`);
  }
});

test('en ny del af sangen opdages én gang, kort efter skiftet', () => {
  // Vers til omkvæd: 6 dB kraftigere og lysere klang. Et større spring ville være et drop.
  const result = simulate({
    seconds: 48,
    parts: [
      { from: 0, to: 24, loud: -24, shares: [0.6, 0.3, 0.1], beats: true },
      { from: 24, to: 48, loud: -18, shares: [0.45, 0.33, 0.22], beats: true },
    ],
  });
  assert.deepEqual(result.events.filter((e) => e.type === 'drop'), []);
  const sections = result.events.filter((e) => e.type === 'section');
  assert.equal(sections.length, 1, JSON.stringify(sections));
  assert.ok(sections[0].t > 24.5 && sections[0].t < 30, `opdaget ved ${sections[0].t.toFixed(2)} s`);
  assert.equal(sections[0].reason, 'louder');
});

test('en jævn sang giver ingen falske nye dele', () => {
  const result = simulate({ seconds: 45 });
  assert.deepEqual(result.events.filter((e) => e.type === 'section' || e.type === 'drop'), []);
});

test('et drop efter en rolig del opdages med det samme', () => {
  const result = simulate({
    seconds: 30,
    parts: [
      { from: 0, to: 20, loud: -30, shares: [0.5, 0.35, 0.15], beats: true },
      { from: 20, to: 30, loud: -14, shares: [0.55, 0.3, 0.15], beats: true },
    ],
  });
  const drops = result.events.filter((e) => e.type === 'drop');
  assert.equal(drops.length, 1, JSON.stringify(drops));
  assert.ok(drops[0].t >= 20 && drops[0].t < 20.3, `drop ved ${drops[0].t.toFixed(3)} s`);
});

// Et langsomt nummer (90 BPM), hvor en passage kører i 3:2-pulsen (135 BPM): bagefter skal tempoet hurtigt
// tilbage til sangens eget i stedet for at blive hængende ved 135, der ligger tættere på de typiske 120.
const SHUFFLE_SONG = [
  { from: 0, to: 60, loud: -20, shares: [0.6, 0.3, 0.1], beats: true },
  { from: 60, to: 80, loud: -20, shares: [0.6, 0.3, 0.1], beats: true, bpm: 135 },
  { from: 80, to: 100, loud: -20, shares: [0.6, 0.3, 0.1], beats: true, bpm: 90 },
];

test('efter en passage i 3:2-pulsen vender tempoet hurtigt tilbage til sangens eget', () => {
  const tempoAt = (result, at) => {
    const e = result.events.filter((x) => x.type === 'beat' && x.t <= at).pop();
    return e && e.bpm;
  };
  const result = simulate({ seconds: 88, bpm: 90, parts: SHUFFLE_SONG });
  const bpm = tempoAt(result, 87.5);
  assert.ok(Math.abs(bpm - 90) < 2, `${bpm && bpm.toFixed(1)} BPM 7,5 s efter passagen`);
  // Uden sangens tempo (det gamle forløb) hænger 135 ved.
  const old = simulate({ seconds: 88, bpm: 90, parts: SHUFFLE_SONG, options: { songTempoMinSec: Infinity } });
  assert.ok(Math.abs(tempoAt(old, 87.5) - 135) < 3, 'testen skelner');
});

test('et nyt tempo i en ny del af sangen følges inden for få sekunder', () => {
  const parts = [
    { from: 0, to: 60, loud: -24, shares: [0.6, 0.3, 0.1], beats: true, bpm: 90 },
    { from: 60, to: 90, loud: -16, shares: [0.35, 0.45, 0.2], beats: true, bpm: 128 },
  ];
  const follows = (result) => {
    const beats = result.events.filter((e) => e.type === 'beat' && e.t > 60);
    const hit = beats.find((e, i) => beats.slice(i, i + 8).every((x) => Math.abs(x.bpm - 128) / 128 < 0.03));
    return hit ? hit.t - 60 : Infinity;
  };
  const after = follows(simulate({ seconds: 90, bpm: 90, parts }));
  assert.ok(after < 8, `fulgte efter ${after.toFixed(1)} s`);
  // Uden det frie vindue efter en ny del (det gamle forløb) tager det ca. dobbelt så lang tid (12 s).
  const old = follows(simulate({ seconds: 90, bpm: 90, parts, options: { tempoFreeSec: 0 } }));
  assert.ok(old > 10, `uden: ${old.toFixed(1)} s`);
});

test('en rolig intro, hvor instrumenterne kommer ind ét ad gangen, giver ingen drops', () => {
  const parts = [
    { from: 0, to: 6, loud: -44, shares: [0.2, 0.5, 0.3], beats: true },
    { from: 6, to: 14, loud: -35, shares: [0.4, 0.4, 0.2], beats: true },
    { from: 14, to: 40, loud: -24, shares: [0.5, 0.35, 0.15], beats: true },
    // En stille passage, og så vender musikken tilbage, men svagere end før: heller ikke et drop.
    { from: 40, to: 48, loud: -44, shares: [0.3, 0.5, 0.2], beats: true },
    { from: 48, to: 60, loud: -34, shares: [0.5, 0.35, 0.15], beats: true },
  ];
  const result = simulate({ seconds: 60, bpm: 90, parts });
  const drops = result.events.filter((e) => e.type === 'drop');
  assert.equal(drops.length, 0, JSON.stringify(drops.map((d) => d.t.toFixed(1))));
  const old = simulate({ seconds: 60, bpm: 90, parts, options: { dropEarlyExtraDb: 0, dropBelowSongDb: Infinity } });
  assert.ok(old.events.some((e) => e.type === 'drop'), 'testen skelner');
});

test('slagene meldes lidt før tid, så billedet skifter samtidig med lyden', () => {
  const result = simulate({ seconds: 16, bpm: 120 });
  const leads = result.events.filter((e) => e.type === 'beat' && e.t > 8).map((e) => e.t - e.emittedAt);
  leads.sort((a, b) => a - b);
  const median = leads[leads.length >> 1];
  assert.ok(median > 0.02 && median < 0.06, `meldt ${Math.round(median * 1000)} ms før slaget`);
});

// Vers, så en opbygning på 16 s (+16 dB og en trommehvirvel), så et drop.
const BUILD_SONG = [
  { from: 0, to: 20, loud: -26, shares: [0.55, 0.3, 0.15], beats: true },
  { from: 20, to: 36, loud: -26, loudTo: -10, subdivTo: 4, shares: [0.3, 0.35, 0.35], beats: true },
  { from: 36, to: 48, loud: -6, shares: [0.6, 0.25, 0.15], beats: true },
];

test('en opbygning før et drop opdages, og droppet fanges alligevel', () => {
  const result = simulate({ seconds: 48, parts: BUILD_SONG });
  const builds = result.events.filter((e) => e.type === 'buildup');
  assert.equal(builds.length, 1, JSON.stringify(builds));
  assert.ok(builds[0].t > 21 && builds[0].t < 30, `opbygning opdaget ved ${builds[0].t.toFixed(2)} s`);
  const drops = result.events.filter((e) => e.type === 'drop');
  assert.equal(drops.length, 1, JSON.stringify(drops));
  assert.ok(drops[0].t >= 36 && drops[0].t < 36.3, `drop ved ${drops[0].t.toFixed(3)} s`);
  assert.ok(drops[0].afterBuild);
  assert.ok(!result.engine.state.building, 'opbygningen slutter med droppet');
});

test('et trin fra vers til omkvæd er ikke en opbygning', () => {
  const result = simulate({
    seconds: 48,
    parts: [
      { from: 0, to: 24, loud: -24, shares: [0.6, 0.3, 0.1], beats: true },
      { from: 24, to: 48, loud: -18, shares: [0.45, 0.33, 0.22], beats: true },
    ],
  });
  assert.deepEqual(result.events.filter((e) => e.type === 'buildup'), []);
});

test('instruktøren skifter tættere i opbygningen og klipper hårdt på droppet', () => {
  const director = new PresetDirector({ random: seeded(3) });
  const engine = new MusicEngine({ onsetLatency: 0 });
  // Samme sang, men drevet gennem både motor og instruktør billede for billede.
  const period = 60 / 128;
  const actions = [];
  for (let k = 0; k / 60 < 48; k++) {
    const t = k / 60;
    const part = BUILD_SONG.find((p) => t >= p.from && t < p.to) || BUILD_SONG[2];
    const progress = Math.min(1, Math.max(0, (t - part.from) / (part.to - part.from)));
    const loud = part.loudTo === undefined ? part.loud : part.loud + (part.loudTo - part.loud) * progress;
    const subdiv = part.subdivTo ? Math.pow(2, Math.floor(progress * 2 + 1e-9)) : 1;
    const sub = period / subdiv;
    const onBeat = t >= 0.25 && ((t - 0.25) % sub) < 1 / 60;
    const level = Math.pow(10, loud / 20) * (onBeat ? 1.3 : 1);
    const e = level * level;
    const f = { rms: level, rmsDb: 20 * Math.log10(level), bass: e * part.shares[0], mid: e * part.shares[1], treb: e * part.shares[2], flux: onBeat ? 3 : 0.25, kickFlux: onBeat ? 2 : 0.03 };
    const events = engine.update(t, f);
    const action = director.update(t, events, engine.state, CFG);
    if (action) actions.push({ ...action, t });
  }
  const inBuild = actions.filter((a) => a.reason === 'build');
  assert.ok(inBuild.length >= 4, `${inBuild.length} skift i opbygningen`);
  const gaps = inBuild.slice(1).map((a, i) => a.t - inBuild[i].t);
  assert.ok(Math.min(...gaps.slice(-2)) < Math.max(...gaps.slice(0, 2)), 'skiftene kommer tættere mod slutningen');
  const drop = actions.find((a) => a.reason === 'drop');
  assert.ok(drop && drop.hard && drop.t >= 36 && drop.t < 36.3, `hårdt klip ved ${drop && drop.t.toFixed(3)} s`);
});

test('stilhed giver sleep og ingen slag, og musik giver wake', () => {
  const result = simulate({
    seconds: 24,
    parts: [
      { from: 0, to: 10, loud: -20, shares: [0.6, 0.3, 0.1], beats: true },
      { from: 10, to: 14, silent: true },
      { from: 14, to: 24, loud: -20, shares: [0.6, 0.3, 0.1], beats: true },
    ],
  });
  const kinds = result.events.filter((e) => e.type === 'sleep' || e.type === 'wake').map((e) => [e.type, Math.round(e.t * 10) / 10]);
  assert.deepEqual(kinds.map((k) => k[0]), ['wake', 'sleep', 'wake']);
  assert.ok(kinds[1][1] >= 11.9 && kinds[1][1] <= 12.2, `sleep ved ${kinds[1][1]} s (2 s stilhed)`);
  assert.ok(kinds[2][1] >= 14 && kinds[2][1] <= 14.3, `wake ved ${kinds[2][1]} s`);
  const beatsInSilence = result.events.filter((e) => e.type === 'beat' && e.t > 12.1 && e.t < 14);
  assert.deepEqual(beatsInSilence, []);
  assert.equal(result.engine.state.silent, false);
});

test('svag baggrundslyd vækker ikke visualizeren, og Spotifys pause har forrang', () => {
  // Målt på Peters pc: andre programmer giver -55 til -63 dB, mens Spotify er på pause.
  const faint = { rms: 0.001, rmsDb: -60, bass: 1e-6, mid: 1e-7, treb: 1e-8, flux: 0.3, kickFlux: 0.1 };
  const music = { rms: 0.1, rmsDb: -20, bass: 1e-2, mid: 5e-3, treb: 1e-3, flux: 0.3, kickFlux: 0.1 };
  const run = (hint, frame, seconds = 3) => {
    const engine = new MusicEngine();
    engine.setPlaybackHint(hint);
    const events = [];
    for (let k = 0; k < seconds * 60; k++) events.push(...engine.update(k / 60, frame));
    return { engine, kinds: events.map((e) => e.type) };
  };
  assert.equal(run(null, faint).engine.state.silent, true, 'uden Spotify-oplysninger');
  assert.equal(run(false, faint).engine.state.silent, true, 'Spotify på pause');
  assert.equal(run(null, music).engine.state.silent, false, 'tydelig musik uden Spotify');
  assert.equal(run(true, faint).engine.state.silent, false, 'Spotify spiller her: selv svag lyd er musik');
  const paused = run(false, { ...music, rms: 0.005, rmsDb: -46 });
  assert.equal(paused.engine.state.silent, true, 'Spotify på pause: -46 dB tæller ikke');
});

test('FeatureExtractor måler bånd, flux og kick-stigning', () => {
  const fx = new FeatureExtractor(48000, 2048);
  const quiet = new Float32Array(1024).fill(-100);
  fx.extract(quiet, 0.1);
  const loudBass = new Float32Array(1024).fill(-100);
  for (let i = 2; i <= 5; i++) loudBass[i] = -10; // ca. 47-117 Hz
  const f = fx.extract(loudBass, 0.3);
  assert.ok(f.bass > f.mid && f.bass > f.treb);
  assert.ok(f.flux > 0);
  assert.ok(f.kickFlux > 0);
  const again = fx.extract(loudBass, 0.3);
  assert.equal(again.flux, 0, 'intet nyt, ingen flux');
  assert.equal(again.kickFlux, 0);
});

// ---------------------------------------------------------------------------
// Instruktøren
// ---------------------------------------------------------------------------

const CFG = { autoCycle: true, cycleSeconds: 10, blendSeconds: 2.7, beatSync: true, sectionChanges: true, hardCuts: true };
const noTempo = { silent: false, tempoValid: false, bpm: null, energy: 'mid' };
const withTempo = { silent: false, tempoValid: true, bpm: 120, energy: 'mid' };

function drive(director, { from, to, state, cfg = CFG, eventsAt = () => [] }) {
  const actions = [];
  for (let t = from; t <= to + 1e-9; t = Math.round((t + 0.05) * 1000) / 1000) {
    const action = director.update(t, eventsAt(t), state, cfg);
    if (action) actions.push({ t, ...action });
  }
  return actions;
}

test('uden tempo skiftes der efter tid', () => {
  const director = new PresetDirector({ random: () => 0.5 });
  const actions = drive(director, { from: 0, to: 25, state: noTempo });
  assert.deepEqual(actions.map((a) => [a.t, a.reason, a.blendSeconds]), [[10, 'timer', 2.7], [20, 'timer', 2.7]]);
});

test('med tempo venter skiftet på taktens første slag, og overgangen varer en takt', () => {
  const director = new PresetDirector({ random: () => 0.5 });
  // Slag hvert 0,5 s (120 BPM); taktens første slag hvert 2 s ved 0,1 + 2k.
  const eventsAt = (t) => {
    const k = Math.round((t - 0.1) / 0.5);
    if (Math.abs(t - (0.1 + k * 0.5)) > 1e-6) return [];
    return [{ type: 'beat', t, downbeat: k % 4 === 0 }];
  };
  const actions = drive(director, { from: 0.05, to: 13, state: withTempo, eventsAt });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].t, 10.1, 'første downbeat efter tiden er gået');
  assert.equal(actions[0].blendSeconds, 2, 'en takt ved 120 BPM');
});

test('ny del af sangen giver et skift på næste downbeat', () => {
  const director = new PresetDirector({ random: () => 0.5 });
  const eventsAt = (t) => {
    const out = [];
    if (Math.abs(t - 8.5) < 1e-6) out.push({ type: 'section', t, index: 2 });
    const k = Math.round((t - 0.1) / 0.5);
    if (Math.abs(t - (0.1 + k * 0.5)) < 1e-6) out.push({ type: 'beat', t, downbeat: k % 4 === 0 });
    return out;
  };
  const actions = drive(director, { from: 0.05, to: 11, state: withTempo, eventsAt });
  assert.deepEqual(actions.map((a) => [a.t, a.reason]), [[10.1, 'section']]);
});

test('et drop giver et hårdt klip med det samme', () => {
  const director = new PresetDirector({ random: () => 0.5 });
  const actions = drive(director, {
    from: 0,
    to: 6,
    state: withTempo,
    eventsAt: (t) => (Math.abs(t - 5.2) < 1e-6 ? [{ type: 'drop', t }] : []),
  });
  assert.deepEqual(actions.map((a) => [a.t, a.reason, a.hard, a.blendSeconds]), [[5.2, 'drop', true, 0]]);
});

test('ingen automatiske skift, når auto er slået fra, eller mens der er stille', () => {
  const off = new PresetDirector({ random: () => 0.5 });
  assert.deepEqual(drive(off, { from: 0, to: 30, state: noTempo, cfg: { ...CFG, autoCycle: false } }), []);

  const quiet = new PresetDirector({ random: () => 0.5 });
  assert.deepEqual(drive(quiet, { from: 0, to: 30, state: { ...noTempo, silent: true } }), []);
  // Tælleren stod stille under stilheden, så der går stadig 10 s, når musikken kommer.
  const after = drive(quiet, { from: 30.05, to: 45, state: noTempo });
  assert.equal(after[0].t, 40);
});

test('et manuelt skift nulstiller tælleren', () => {
  const director = new PresetDirector({ random: () => 0.5 });
  drive(director, { from: 0, to: 7, state: noTempo });
  director.notifyChange(7, CFG);
  const actions = drive(director, { from: 7.05, to: 18, state: noTempo });
  assert.equal(actions[0].t, 17);
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

test('profilen tæller bas, mellemtone og diskant i ligninger og shadere', () => {
  const bassy = profilePreset({
    baseVals: { wave_a: 0 },
    frame_eqs_str: 'a.zoom = 1 + 0.1*a.bass; a.rot = a.bass_att*0.02; a.warp = a.bass;',
    pixel_eqs_str: '',
    warp: 'uniform float treb_att; ret = treb_att;',
    comp: '',
    shapes: [],
    waves: [],
  });
  assert.deepEqual(bassy.counts, [3, 0, 2]);
  assert.ok(bassy.affinity[0] > bassy.affinity[2] && bassy.affinity[2] > bassy.affinity[1]);

  const ambient = profilePreset({ baseVals: { wave_a: 0 }, frame_eqs_str: 'a.rot = 0.01;', shapes: [], waves: [] });
  assert.deepEqual(ambient.counts, [0, 0, 0]);
  assert.ok(ambient.reactivity < bassy.reactivity);
});

test('scorePreset foretrækker presets, der reagerer på det bånd der fylder nu', () => {
  const bassy = { affinity: [0.7, 0.2, 0.1], reactivity: 0.8 };
  const bright = { affinity: [0.1, 0.2, 0.7], reactivity: 0.8 };
  const bassSection = { dominance: [0.6, 0.25, 0.15], targetReactivity: 0.85 };
  const hatSection = { dominance: [0.15, 0.25, 0.6], targetReactivity: 0.85 };
  assert.ok(scorePreset(bassy, bassSection, 0) > scorePreset(bright, bassSection, 0));
  assert.ok(scorePreset(bright, hatSection, 0) > scorePreset(bassy, hatSection, 0));
  const calm = { dominance: [1 / 3, 1 / 3, 1 / 3], targetReactivity: 0.3 };
  const ambient = { affinity: [1 / 3, 1 / 3, 1 / 3], reactivity: 0.2 };
  assert.ok(scorePreset(ambient, calm, 0) > scorePreset(bassy, calm, 0));
});

test('med målte presets vælges intensiteten efter musikken, og overgangen efter hvorfor der skiftes', () => {
  const even = [1 / 3, 1 / 3, 1 / 3];
  // stats: [lysstyrke, bevægelse, takt, farver, detaljer] som placering blandt alle presets.
  const calm = { affinity: even, reactivity: 0.5, stats: [0.3, 0.1, 0.2, 0.5, 0.5] };
  const wild = { affinity: even, reactivity: 0.5, stats: [0.8, 0.95, 0.9, 0.5, 0.5] };
  const brightMid = { affinity: even, reactivity: 0.5, stats: [0.9, 0.5, 0.5, 0.5, 0.5] };
  const darkMid = { affinity: even, reactivity: 0.5, stats: [0.15, 0.55, 0.5, 0.5, 0.5] };
  const ctx = (extra) => ({ dominance: even, targetReactivity: 0.55, tempoValid: false, ...extra });

  // Rolig del: det rolige preset vinder; høj energi: det vilde.
  assert.ok(scorePreset(calm, ctx({ targetIntensity: 0.25 }), 0) > scorePreset(wild, ctx({ targetIntensity: 0.25 }), 0));
  assert.ok(scorePreset(wild, ctx({ targetIntensity: 0.8 }), 0) > scorePreset(calm, ctx({ targetIntensity: 0.8 }), 0));
  // Drop fra et roligt preset: kontrasten trækker det vilde endnu længere op.
  const drop = ctx({ targetIntensity: 0.95, reason: 'drop', current: calm });
  const noContrast = ctx({ targetIntensity: 0.95 });
  assert.ok(scorePreset(wild, drop, 0) - scorePreset(calm, drop, 0) > scorePreset(wild, noContrast, 0) - scorePreset(calm, noContrast, 0));
  // Et blødt skift fra et mørkt preset går helst til en lignende lysstyrke.
  const soft = ctx({ targetIntensity: 0.55, reason: 'section', current: { stats: [0.1, 0.5, 0.5, 0.5, 0.5] } });
  assert.ok(scorePreset(darkMid, soft, 0) > scorePreset(brightMid, soft, 0));
  // Med et tempo vinder det preset, der følger slaget.
  const onBeat = { affinity: even, reactivity: 0.5, stats: [0.5, 0.5, 0.95, 0.5, 0.5] };
  const offBeat = { affinity: even, reactivity: 0.5, stats: [0.5, 0.6, 0.05, 0.5, 0.5] };
  assert.ok(scorePreset(onBeat, ctx({ targetIntensity: 0.55, tempoValid: true }), 0) > scorePreset(offBeat, ctx({ targetIntensity: 0.55, tempoValid: true }), 0));
});

test('uden Spotify: en kort pause mellem to numre giver et nyt nummer, en kort pause tidligt i sangen gør ikke', () => {
  const song = (gapAt) => [
    { from: 0, to: gapAt, loud: -20, shares: [0.6, 0.3, 0.1], beats: true },
    { from: gapAt, to: gapAt + 1.2, silent: true },
    { from: gapAt + 1.2, to: gapAt + 20, loud: -20, shares: [0.6, 0.3, 0.1], beats: true },
  ];
  const late = simulate({ seconds: 55, parts: song(35), options: { audioOnly: true } });
  const tracks = late.events.filter((e) => e.type === 'track');
  assert.equal(tracks.length, 1, JSON.stringify(tracks));
  assert.ok(tracks[0].t > 36 && tracks[0].t < 36.6, `nyt nummer ved ${tracks[0].t}`);
  const early = simulate({ seconds: 30, parts: song(10), options: { audioOnly: true } });
  assert.equal(early.events.filter((e) => e.type === 'track').length, 0, 'pause efter 10 s er ikke et nyt nummer');
  const withSpotify = simulate({ seconds: 55, parts: song(35) });
  assert.equal(withSpotify.events.filter((e) => e.type === 'track').length, 0, 'med Spotify melder Spotify selv nye numre');
});
