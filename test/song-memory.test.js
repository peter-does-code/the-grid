'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SongRecorder, mergeSong, knownEvents } = require('../src/shared/song-memory.js');

/** En afspilning fra start til `to` s med drops og dele på de givne sekunder. */
function play({ to = 200, bpm = 128, drops = [], sections = [], builds = [], startPos = 0 } = {}) {
  const r = new SongRecorder({ id: 'x', startPos });
  for (let pos = startPos; pos <= to; pos += 0.5) {
    r.frame(pos, { bpm, tempoValid: pos > 6, rmsDb: pos > 60 && pos < 120 ? -8 : -26 });
    for (const d of drops) if (Math.abs(d - pos) < 0.25) r.event('drop', d);
    for (const s of sections) if (Math.abs(s - pos) < 0.25) r.event('section', s);
    for (const b of builds) if (Math.abs(b - pos) < 0.25) r.event('build', b);
  }
  return r.finish(210);
}

test('første afspilning: tempo, drops, dele og opbygninger huskes, og sangen får mærker', () => {
  const song = mergeSong(null, play({ drops: [64.2], sections: [32, 64, 128], builds: [56] }), { name: 'Song', genres: ['Techno'] });
  assert.equal(song.plays, 1);
  assert.equal(song.bpm, 128);
  assert.deepEqual(knownEvents(song, 'drop'), [64.2]);
  assert.deepEqual(knownEvents(song, 'section'), [32, 64, 128]);
  assert.deepEqual(knownEvents(song, 'build'), [56]);
  for (const tag of ['techno', 'mid-tempo', 'dynamic']) assert.ok(song.tags.includes(tag), `${tag} i ${song.tags}`);
  assert.ok(!song.tags.includes('drops'), 'et drop hørt én gang er ikke et mærke endnu');
  const again = mergeSong(song, play({ drops: [64.2], sections: [32, 64, 128], builds: [56] }));
  assert.ok(again.tags.includes('drops') && again.tags.includes('build-ups'), `${again.tags}`);
});

test('flere afspilninger: et drop, der hørtes igen, flyttes lidt; et falsk drop, der kun kom én gang, glemmes', () => {
  let song = mergeSong(null, play({ drops: [64.2, 150] }));
  song = mergeSong(song, play({ drops: [64.6] }));
  song = mergeSong(song, play({ drops: [64.4] }));
  const drops = knownEvents(song, 'drop');
  assert.equal(drops.length, 1, JSON.stringify(song.drops));
  assert.ok(Math.abs(drops[0] - 64.4) < 0.05, `drop ved ${drops[0]}`);
  assert.equal(song.plays, 3);
});

test('tempoet: tæt på gennemsnittes; et enkelt forkert bud (dobbelt tempo) tager ikke over', () => {
  let song = mergeSong(null, play({ bpm: 90 }));
  song = mergeSong(song, play({ bpm: 91 }));
  song = mergeSong(song, play({ bpm: 180 }));
  assert.ok(Math.abs(song.bpm - 90.5) < 0.01, `bpm ${song.bpm}`);
});

test('for lidt hørt, eller sprunget ind midt i sangen: ingenting læres', () => {
  assert.equal(play({ to: 30 }), null);
  assert.equal(play({ startPos: 60, to: 200 }), null);
});

test('et drop sidst i sangen, som en kort afspilning ikke nåede til, tæller stadig', () => {
  let song = mergeSong(null, play({ drops: [64, 190] }));
  song = mergeSong(song, play({ drops: [64], to: 150 }));
  assert.deepEqual(knownEvents(song, 'drop'), [64, 190]);
});
