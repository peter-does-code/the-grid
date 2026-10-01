'use strict';

// Kører Drew-showet i Node med et falsk lærred, der opfører sig som det rigtige: ctx.arc kaster ved
// en negativ radius. Slagene kommer fra musikmotoren med performance.now(), mens tegneløkken bruger
// billedets tidsstempel, der kan ligge lidt bagud (fejlen, der fik showet til at gå i stå, 30-09-2026).
const test = require('node:test');
const assert = require('node:assert/strict');

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {
      arc(x, y, r) {
        if (r < 0) throw new RangeError(`The radius provided (${r}) is negative.`);
      },
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

function element() {
  return { hidden: false, style: {}, textContent: '', classList: { add() {}, remove() {} } };
}

test('Drew-showet tegner videre, når slagene ligger foran tegneløkken i tid', () => {
  let now = 0;
  let rafCallback = null;
  global.performance = { now: () => now };
  global.window = { innerWidth: 1200, innerHeight: 760, devicePixelRatio: 1 };
  global.requestAnimationFrame = (fn) => {
    rafCallback = fn;
    return 1;
  };
  global.cancelAnimationFrame = () => {};
  delete require.cache[require.resolve('../src/renderer/drew.js')];
  require('../src/renderer/drew.js');
  const img = { ...element(), hidden: true };
  const show = new global.window.Visamp.DrewShow(element(), {
    canvas: { width: 0, height: 0, getContext: () => fakeContext() },
    img,
    placeholder: element(),
    title: element(),
    sub: element(),
    stage: element(),
    lines: ['A', 'B'],
    level: () => 0.8,
    sources: [],
    trackTime: () => 30, // midt i hamren
  });
  show.start();
  let frames = 0;
  for (let i = 0; i < 600; i++) {
    now += 16;
    // Musikmotoren melder et slag lige nu; billedets tidsstempel er 8 ms bagud.
    if (i % 20 === 0) show.beat({ downbeat: i % 80 === 0 });
    const cb = rafCallback;
    rafCallback = null;
    cb(now - 8);
    if (rafCallback) frames++;
  }
  assert.equal(frames, 600, 'tegneløkken kørte hele vejen');
  assert.ok(show.beats > 20, 'slagene blev talt');
  assert.match(show.o.placeholder.style.transform || '', /scale/, 'billedet bevæger sig');
  show.stop();
});

test('med beat-kortet slår Drew præcist på sangens slag, også efter løkken', () => {
  let now = 0;
  let rafCallback = null;
  global.performance = { now: () => now };
  global.window = { innerWidth: 1200, innerHeight: 760, devicePixelRatio: 1 };
  global.requestAnimationFrame = (fn) => {
    rafCallback = fn;
    return 1;
  };
  global.cancelAnimationFrame = () => {};
  delete require.cache[require.resolve('../src/renderer/drew.js')];
  delete require.cache[require.resolve('../src/renderer/media/init-beats.js')];
  require('../src/renderer/drew.js');
  require('../src/renderer/media/init-beats.js');
  const map = global.window.Visamp.INIT_BEATS;
  let song = 8; // sangens tid; løber med
  const hits = [];
  const show = new global.window.Visamp.DrewShow(element(), {
    canvas: { width: 0, height: 0, getContext: () => fakeContext() },
    img: { ...element(), hidden: true },
    placeholder: element(),
    title: element(),
    sub: element(),
    stage: element(),
    lines: ['A'],
    sources: [],
    trackTime: () => song,
    beatMap: map,
  });
  const realHit = show.hit.bind(show);
  show.hit = (tt, down) => {
    hits.push({ song, down });
    realHit(tt, down);
  };
  show.start();
  const step = () => {
    now += 16;
    const cb = rafCallback;
    rafCallback = null;
    cb(now);
  };
  // 8 → 30 s: alle slag i kortet fra første bas-slag til 30 s, hver på sit eget billede.
  while (song < 30) {
    song += 0.016;
    step();
    show.beat({ downbeat: false }); // musikmotorens slag ignoreres, når kortet styrer
  }
  const expected = map.beats.filter((b) => b <= 30.015);
  assert.equal(hits.length, expected.length, 'et slag pr. slag i kortet');
  assert.ok(Math.abs(hits[0].song - map.beats[0]) < 0.02, 'første slag ved bassens start');
  assert.ok(hits[0].down, 'første slag er en taktstart');
  // Løkken hopper fra 67 til 23 s: slagene fortsætter derfra.
  song = 23;
  hits.length = 0;
  while (song < 26) {
    song += 0.016;
    step();
  }
  assert.equal(hits.length, map.beats.filter((b) => b > 23 && b <= 26.015).length);
  show.stop();
});

test('beat-kortet passer til sangen: jævnt tempo, taktstart hver fjerde', () => {
  delete require.cache[require.resolve('../src/renderer/media/init-beats.js')];
  global.window = {};
  require('../src/renderer/media/init-beats.js');
  const { beats, downbeats } = global.window.Visamp.INIT_BEATS;
  // Fra første bas-slag (10,45 s) til sangens slutning.
  assert.ok(beats[0] >= 10.3 && beats[0] < 10.6, 'begynder ved første hørbare bas-slag (10,45 s)');
  assert.ok(beats[beats.length - 1] >= 120, 'dækker hele sangen (2:08)');
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    // Bas-slagene i starten ligger tættere (bassen spiller også på bagslaget); gitteret er jævnt.
    if (beats[i - 1] >= 14.3) assert.ok(d > 0.6 && d < 0.69, `interval ${d.toFixed(3)} s ved ${beats[i]}`);
    else assert.ok(d >= 0.3, `bas-slag for tæt ved ${beats[i]}`);
  }
  assert.equal(downbeats[0], 0, 'første bas-slag er en entré');
  for (let i = 2; i < downbeats.length; i++) assert.equal(downbeats[i] - downbeats[i - 1], 4);
});

test('Drew toner ud i sangens sidste sekunder', () => {
  let now = 0;
  let rafCallback = null;
  global.performance = { now: () => now };
  global.window = { innerWidth: 1200, innerHeight: 760, devicePixelRatio: 1 };
  global.requestAnimationFrame = (fn) => {
    rafCallback = fn;
    return 1;
  };
  global.cancelAnimationFrame = () => {};
  delete require.cache[require.resolve('../src/renderer/drew.js')];
  require('../src/renderer/drew.js');
  let song = 60;
  const img = element(); // uden billedfiler vises pladsholderen; det er den, der toner
  const sub = element();
  const show = new global.window.Visamp.DrewShow(element(), {
    canvas: { width: 0, height: 0, getContext: () => fakeContext() },
    img: { ...element(), hidden: true },
    placeholder: img,
    title: element(),
    sub,
    stage: element(),
    lines: ['A'],
    sources: [],
    trackTime: () => song,
    songLength: () => 128,
  });
  show.start();
  const frameAt = (s) => {
    song = s;
    now += 16;
    const cb = rafCallback;
    rafCallback = null;
    cb(now);
  };
  frameAt(60);
  assert.equal(Number(img.style.opacity), 1, 'fuldt synlig midt i sangen');
  frameAt(125);
  const middle = Number(img.style.opacity);
  assert.ok(middle > 0.2 && middle < 0.9, `halvvejs udtonet 3 s før slut (${middle})`);
  frameAt(127.99);
  assert.ok(Number(img.style.opacity) < 0.02, 'væk ved sangens slutning');
  assert.ok(Number(sub.style.opacity) < 0.02, 'teksten også');
  assert.ok(show.intensity < 0.02, 'hamren er ebbet ud');
  show.stop();
});
