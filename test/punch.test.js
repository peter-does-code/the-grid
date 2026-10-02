'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const P = require('../src/shared/punch');

const close = (a, b) => Math.abs(a - b) < 1e-6; // Butterchurn gemmer niveauerne som Float32

test('punch spreder niveauerne omkring 1,0 og klemmer ved 0', () => {
  assert.equal(P.PUNCH_K, 1.3);
  assert.ok(close(P.punchValue(1, 1.3), 1), 'gennemsnittet flytter sig ikke');
  assert.ok(close(P.punchValue(1.5, 1.3), 1.65));
  assert.ok(close(P.punchValue(0.7, 1.3), 0.61));
  assert.equal(P.punchValue(0, 1.3), 0, 'aldrig negativ');
  assert.equal(P.punchValue(0.2, 1.3), 0);
  for (const v of [0, 0.4, 1, 2.7]) assert.ok(close(P.punchValue(v, 1), v), 'k = 1 er uændret');
  const levels = { bass: 2, bass_att: 1.2, mid: 1, mid_att: 0.9, treb: 0.5, treb_att: 1.1, other: 7 };
  const out = P.punchLevels(levels);
  assert.deepEqual(Object.keys(out), P.LEVEL_KEYS);
  assert.ok(close(out.bass, 2.3) && close(out.mid, 1) && close(out.treb, 0.35) && close(out.treb_att, 1.13));
});

/** Som Butterchurns AudioLevels: getters på prototypen, værdier i typede arrays, opdateres af updateAudioLevels. */
class FakeAudioLevels {
  constructor() {
    this.val = new Float32Array(3); // som Butterchurn: 0 før første opdatering
    this.att = new Float32Array(3).fill(1);
    this.calls = [];
  }
  updateAudioLevels(fps, frame) {
    this.calls.push([fps, frame]);
    this.val.set([1.5, 0.7, 2]);
    this.att.set([1.2, 1, 0.9]);
  }
  get bass() { return this.val[0]; }
  get bass_att() { return this.att[0]; }
  get mid() { return this.val[1]; }
  get mid_att() { return this.att[1]; }
  get treb() { return this.val[2]; }
  get treb_att() { return this.att[2]; }
}

/** De seks værdier, som Butterchurns render() og loadPreset() lægger i globalVars. */
const globalVars = (levels) => ({
  bass: levels.bass,
  bass_att: levels.bass_att,
  mid: levels.mid,
  mid_att: levels.mid_att,
  treb: levels.treb,
  treb_att: levels.treb_att,
});

test('wrapperen kalder Butterchurns opdatering og giver presets niveauerne med punch', () => {
  const original = new FakeAudioLevels();
  let k = 1.3;
  const wrapped = P.wrapAudioLevels(original, () => k);
  // loadPreset() før første billede: Butterchurns startværdier, gyldige tal.
  const before = globalVars(wrapped);
  assert.deepEqual(before, { bass: 0, bass_att: 1, mid: 0, mid_att: 1, treb: 0, treb_att: 1 });
  // render(): updateAudioLevels(fps, frameNum), derefter de seks værdier.
  wrapped.updateAudioLevels(60, 12);
  assert.deepEqual(original.calls, [[60, 12]]);
  const vars = globalVars(wrapped);
  assert.ok(close(vars.bass, 1.65) && close(vars.mid, 0.61) && close(vars.treb, 2.3));
  assert.ok(close(vars.bass_att, 1.26) && close(vars.mid_att, 1) && close(vars.treb_att, 0.87));
  for (const v of Object.values(vars)) assert.ok(Number.isFinite(v) && v >= 0);
  // Indstillingen slået fra: Butterchurns egne værdier med det samme, uden ny opdatering.
  k = 1;
  assert.ok(close(wrapped.bass, 1.5) && close(wrapped.mid, 0.7) && close(wrapped.treb, 2));
  assert.equal(wrapped.original, original);
  assert.throws(() => P.wrapAudioLevels({}, () => 1), TypeError);
});

test('Butterchurn (låst version) læser kun de seks niveauer og updateAudioLevels fra renderer.audioLevels', () => {
  const pkg = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
  assert.equal(pkg.dependencies.butterchurn, '2.6.7', 'wrapperen er kun tjekket mod 2.6.7');
  const source = fs.readFileSync(require.resolve('butterchurn/lib/butterchurn.min.js'), 'utf8');
  const used = new Set([...source.matchAll(/this\.audioLevels\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), [...P.LEVEL_KEYS, 'updateAudioLevels'].sort());
  // Objektet oprettes ét sted (i Rendererens constructor) og skiftes aldrig ud bag wrapperens ryg.
  assert.equal([...source.matchAll(/this\.audioLevels\s*=/g)].length, 1);
});
