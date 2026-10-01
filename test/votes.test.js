'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VoteQueue } = require('../src/main/votes.js');

function setup({ ok = true, token = 'tok' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'the-grid-votes-'));
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (!ok) throw new Error('offline');
    return { ok: true, status: 201 };
  };
  const make = () => new VoteQueue({ dir, token, owner: 'o', repo: 'r', version: '9.9.9', getId: () => 'abcd1234', log: { warn() {} }, fetchImpl });
  return { dir, calls, make };
}

test('stemmer sendes som ét issue med presetnavn, stemme, version og anonymt id', async () => {
  const { calls, make } = setup();
  const q = make();
  q.add({ preset: 'Flexi - alien fish pond', vote: 'derez' });
  q.add({ preset: 'Geiss - Swirl', vote: 'keep' });
  assert.equal(await q.flush(), 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/issues');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(calls[0].opts.body);
  assert.match(body.title, /^votes abcd1234 v9\.9\.9 \(2\)$/);
  const data = JSON.parse(body.body.split('```json')[1].split('```')[0]);
  assert.deepEqual(data.votes.map((v) => [v.preset, v.vote]), [['Flexi - alien fish pond', 'derez'], ['Geiss - Swirl', 'keep']]);
  assert.equal(q.pending.length, 0, 'køen er tom');
  q.timer && clearTimeout(q.timer);
});

test('uden net bliver stemmerne i køen, også efter genstart, og sendes senere', async () => {
  const offline = setup({ ok: false });
  const q = offline.make();
  q.add({ preset: 'A', vote: 'keep' });
  assert.equal(await q.flush(), 0);
  clearTimeout(q.timer);
  const again = new VoteQueue({ dir: offline.dir, token: 'tok', owner: 'o', repo: 'r', version: '1', getId: () => 'x', log: { warn() {} }, fetchImpl: async () => ({ ok: true, status: 201 }) });
  assert.equal(again.pending.length, 1, 'gemt på disken');
  assert.equal(await again.flush(), 1);
});

test('uden token sendes intet', async () => {
  const { calls, make } = setup({ token: null });
  const q = make();
  q.add({ preset: 'A', vote: 'derez' });
  clearTimeout(q.timer);
  assert.equal(await q.flush(), 0);
  assert.equal(calls.length, 0);
});
