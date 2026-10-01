'use strict';

// Kører introen i Node med et falsk lærred og en fast tidslinje, så koreografien kan tjekkes uden Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
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

function loadIntro(style = 'duel') {
  global.window = { innerWidth: 1200, innerHeight: 760, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  global.window.GridFont = require('../src/shared/grid-font');
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.performance = global.performance || { now: () => 0 };
  for (const file of ['intro.js', 'intro-war.js']) {
    delete require.cache[path.resolve(__dirname, '../src/renderer', file)];
    require(path.resolve(__dirname, '../src/renderer', file));
  }
  return style === 'war' ? global.window.Visamp.GridIntroWar : global.window.Visamp.GridIntro;
}

/** Seedet tilfældighed, så testen er ens hver gang. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function run(opts, seconds = 40, style = 'duel') {
  const GridIntro = loadIntro(style);
  const root = { hidden: true, classList: { add() {}, remove() {} }, addEventListener() {}, removeEventListener() {} };
  const canvas = { width: 0, height: 0, getContext: () => fakeContext() };
  let done = null;
  const intro = new GridIntro(root, canvas, { ...opts, onDone: (info) => (done = info) });
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => fn();
  try {
    intro.start();
    const dt = 1 / 60;
    let t = 0;
    const log = { maxAlive: 0, aliveAtDuel: null, deaths: [] };
    while (intro.running && t < seconds) {
      t += dt;
      intro.frame(t, dt);
      const alive = intro.cycles.filter((c) => c.alive).length;
      log.maxAlive = Math.max(log.maxAlive, alive);
      if (log.aliveAtDuel === null && intro.duelStart !== undefined && intro.riders) log.aliveAtDuel = intro.riders.length;
      for (const c of intro.cycles) if (!c.alive && !c.logged) (c.logged = true), log.deaths.push(t);
    }
    return { intro, done, t, log };
  } finally {
    global.setTimeout = realSetTimeout;
  }
}

for (const seed of [1, 2, 3]) {
  test(`WELCOME TO THE GRID: kamp, duel, derez og til sidst GRID (seed ${seed})`, () => {
    const { intro, done, t } = run({ random: seeded(seed) });
    assert.ok(done && done.skipped === false, 'introen blev færdig af sig selv');
    assert.equal(intro.cycles.length, 16);
    assert.ok(intro.cycles.filter((c) => !c.alive).length >= 8, 'mange cykler derezzer i kampen');
    const [winner, loser] = intro.riders;
    assert.ok(loser.dead, 'taberen derezzer');
    // Vinderens væg ligger på tværs af taberens bane, før taberen når dertil.
    const crossAt = intro.duelStart + winner.path.marks.cross / winner.v;
    assert.ok(crossAt < intro.crashAt, `væggen (${crossAt.toFixed(2)} s) før sammenstødet (${intro.crashAt.toFixed(2)} s)`);
    assert.ok(intro.crashAt < intro.textDone, 'GRID skrives efter sammenstødet');
    // Taberen skriver kun linje 1, vinderen resten.
    const words = (rider) => rider.path.segs.filter((s) => s.kind === 'text');
    assert.ok(words(loser).length > 0 && words(winner).some((s) => s.meta.final));
    assert.ok(t < 15, `introen varer ${t.toFixed(1)} s`);
    // Alle stykker er vandrette eller lodrette.
    for (const rider of intro.riders) {
      for (const s of rider.path.segs) assert.ok(Math.abs(s.a[0] - s.b[0]) < 0.01 || Math.abs(s.a[1] - s.b[1]) < 0.01);
    }
  });
}

test('påskeægget FLYNN LIVES: vinderen har intet før det sidste ord', () => {
  const { intro, done } = run({ lines: ['FLYNN', 'LIVES'], battleSeconds: 3.2, cycles: 8, random: seeded(4) });
  assert.ok(done && !done.skipped);
  assert.ok(intro.riders[1].dead);
  assert.ok(intro.crashAt < intro.textDone);
});

test('Konami-koden: kun kamp, til én er tilbage', () => {
  const { intro, done } = run({ lines: [], cycles: 16, battleSeconds: 18, random: seeded(5) }, 30);
  assert.ok(done && !done.skipped);
  assert.equal(intro.riders, undefined);
  assert.ok(intro.cycles.filter((c) => c.alive).length <= 1 || intro.endAt <= 20);
});

// ---------- "The long battle" (intro-war.js), standardintroen ----------

for (const seed of [1, 2, 3, 4]) {
  test(`den lange kamp: gradvis udslettelse, WELCOME TO THE skrives under kampen, vinderen skriver GRID (seed ${seed})`, () => {
    const { intro, done, t, log } = run({ random: seeded(seed) }, 40, 'war');
    assert.ok(done && done.skipped === false, 'introen blev færdig af sig selv');
    // Mange dør, og ikke på én gang: dødsfaldene er spredt over mindst 7 sekunder.
    assert.ok(log.deaths.length >= 14, `${log.deaths.length} derezzet`);
    assert.ok(log.deaths[log.deaths.length - 1] - log.deaths[0] > 7, 'udslettelsen tager tid');
    // Alle skriveopgaver blev løst, mens der stadig var mere end to tilbage.
    for (const job of intro.jobs) {
      assert.ok(job.done, 'alle bogstaver i WELCOME TO THE er skrevet');
      assert.ok(job.doneAt < intro.lastTwoAt + 0.01, 'skrevet før de to sidste kæmper');
    }
    // De to sidste er fra hvert sit hold, kæmper, og vinderen skriver det sidste ord.
    assert.ok(intro.lastTwoAt > 6, `to tilbage efter ${intro.lastTwoAt.toFixed(1)} s`);
    assert.ok(intro.finalJob.done && intro.finalJob.doneAt > intro.finalAt);
    assert.ok(intro.finalJob.writer.alive, 'vinderen lever og har skrevet GRID');
    const strokes = intro.jobs.reduce((n, j) => n + j.strokes.length, 0) + intro.finalJob.strokes.length;
    assert.equal(intro.letters.length, strokes, 'hver streg blev til en bogstavvæg');
    assert.ok(t < 28, `introen varer ${t.toFixed(1)} s`);
    // En rigtig kamp: finalen afgøres af et drab (taberen kører ind i vinderens væg), og de fleste
    // dør, fordi en modstander skar dem af, ikke fordi de kørte ind i en tilfældig væg.
    const { winner, loser } = intro.finalPair;
    assert.notEqual(winner.team, loser.team, 'de to sidste er fra hvert sit hold');
    assert.equal(loser.cause, 'enemy', `finalen endte med ${loser.cause}`);
    assert.equal(loser.killedBy, winner.id, 'vinderen skar taberen af');
    const dead = intro.cycles.filter((c) => !c.alive);
    const kills = dead.filter((c) => c.cause === 'enemy').length;
    assert.ok(kills / dead.length >= 0.5, `${kills} af ${dead.length} blev skåret af`);
    assert.ok(!dead.some((c) => c.cause === 'border' && !c.doomed), 'ingen kører ud over kanten');
  });
}

for (const seed of [5, 6, 7, 8, 9]) {
  test(`Game Grid (kun kamp): der kåres altid en vinder (seed ${seed})`, () => {
    let winnerSeen = null;
    const { intro, done } = run({ lines: [], cycles: 16, battleSeconds: 16, random: seeded(seed) }, 40, 'war');
    winnerSeen = done && done.winner;
    assert.ok(done && !done.skipped, 'kampen sluttede af sig selv');
    assert.ok(winnerSeen, 'der er en vinder');
    assert.ok(['blue', 'orange'].includes(winnerSeen.name));
    assert.equal(intro.cycles.filter((c) => c.alive).length, 1);
    assert.notEqual(intro.finalPair.winner.team, intro.finalPair.loser.team, 'de to sidste er fra hvert sit hold');
    assert.ok(intro.winnerAt > 12, `vinderen fundet efter ${intro.winnerAt.toFixed(1)} s`);
  });
}

test('epic battle: 40 cykler i en større arena kæmper i ca. et minut, til ét hold vinder', () => {
  const { intro, done, t } = run({ lines: [], cycles: 40, gridCells: 90, battleSeconds: 45, random: seeded(3) }, 120, 'war');
  assert.ok(done && !done.skipped && done.winner, 'der er en vinder');
  assert.equal(intro.cycles.length, 40);
  assert.ok(intro.rows >= 80, `arenaen er ${intro.cols}x${intro.rows}`);
  assert.ok(intro.winnerAt > 40 && t < 85, `vinder efter ${intro.winnerAt.toFixed(1)} s, slut ${t.toFixed(1)} s`);
  const dead = intro.cycles.filter((c) => !c.alive);
  assert.ok(dead.filter((c) => c.cause === 'enemy').length / dead.length >= 0.5, 'de fleste bliver skåret af');
});

test('FLYNN LIVES med den lange kamp', () => {
  const { intro, done } = run({ lines: ['FLYNN', 'LIVES'], cycles: 10, duelAt: 7, random: seeded(10) }, 40, 'war');
  assert.ok(done && !done.skipped);
  assert.ok(intro.finalJob.done);
});
