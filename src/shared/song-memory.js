/*
 * Sanghukommelse: hvad musikmotoren lærte om en sang, gemt til næste gang den spilles (Peter 05-10-2026).
 *
 * Mens en sang spiller, noterer en SongRecorder musikmotorens fund efter positionen i sangen (Spotifys
 * afspillerposition, i sekunder): tempo, nye dele, opbygninger, drops og lydstyrken. Når sangen slutter, bliver
 * det til en analyse, der flettes sammen med de tidligere (mergeSong): hvert fund tælles, så et drop, der kun blev
 * hørt én af fem gange, ikke stoler man på. Næste gang kan The Grid kende tempoet fra start og fyre drops og nye
 * dele på det rigtige sekund (knownEvents).
 *
 * Der gemmes kun målinger og tidspunkter, aldrig lyd. Ren JavaScript; bruges af rendereren (optagelse) og testes
 * i Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampSongMemory = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENERGY_STEP = 4; // lydstyrke pr. 4 s
  // Hvor tæt to fund skal ligge (s) for at være det samme ved næste afspilning.
  const MATCH = { drop: 1.5, section: 3, build: 3 };
  const KINDS = ['drop', 'section', 'build'];

  function median(list) {
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  class SongRecorder {
    /** @param {{id: string, startPos: number}} song startPos: hvor i sangen optagelsen begyndte (s) */
    constructor({ id, startPos = 0 }) {
      this.id = id;
      this.startPos = startPos;
      this.lastPos = startPos;
      this.events = { drop: [], section: [], build: [] };
      this.bpms = [];
      this.energy = []; // [sum dB, antal] pr. ENERGY_STEP
    }

    /** Et billede: positionen i sangen, motorens tilstand og lydstyrke. */
    frame(pos, { bpm = null, tempoValid = false, rmsDb = null } = {}) {
      if (!Number.isFinite(pos)) return;
      this.lastPos = Math.max(this.lastPos, pos);
      if (tempoValid && bpm > 0) this.bpms.push(bpm);
      if (Number.isFinite(rmsDb) && rmsDb > -90) {
        const k = Math.floor(pos / ENERGY_STEP);
        if (!this.energy[k]) this.energy[k] = [0, 0];
        this.energy[k][0] += rmsDb;
        this.energy[k][1] += 1;
      }
    }

    /** Et fund fra motoren: 'drop', 'section' eller 'build' (opbygningens start). */
    event(kind, pos) {
      if (!KINDS.includes(kind) || !Number.isFinite(pos)) return;
      const list = this.events[kind];
      // Det samme fund to gange lige efter hinanden (fx et planlagt og et hørt) tælles én gang.
      if (list.length && Math.abs(list[list.length - 1] - pos) < MATCH[kind]) return;
      list.push(pos);
    }

    /**
     * Analysen, eller null, hvis der ikke er hørt nok af sangen til at lære noget (en hel sang regnes fra start,
     * så fund kan tælles; sprang man ind midt i, er "ingen drop før 1:00" ikke en oplysning).
     */
    finish(durationSec) {
      const heard = this.lastPos - this.startPos;
      if (this.startPos > 10 || heard < 45) return null;
      const covered = durationSec ? Math.min(1, this.lastPos / durationSec) : null;
      if (covered !== null && covered < 0.5) return null;
      return {
        bpm: median(this.bpms),
        heardTo: Math.round(this.lastPos),
        drops: this.events.drop.map((p) => Math.round(p * 100) / 100),
        sections: this.events.section.map((p) => Math.round(p * 100) / 100),
        builds: this.events.build.map((p) => Math.round(p * 100) / 100),
        energy: this.energy.map((e) => (e && e[1] ? Math.round((e[0] / e[1]) * 10) / 10 : null)),
      };
    }
  }

  /** Fletter fund fra en ny afspilning ind: tæt på et kendt fund flytter det lidt og tæller det; ellers nyt. */
  function mergeEvents(old, fresh, tol, heardTo) {
    const out = (old || []).map((e) => ({ ...e }));
    for (const pos of fresh) {
      let best = null;
      for (const e of out) if (Math.abs(e.pos - pos) <= tol && (!best || Math.abs(e.pos - pos) < Math.abs(best.pos - pos))) best = e;
      if (best) {
        best.pos = Math.round(((best.pos * best.count + pos) / (best.count + 1)) * 100) / 100;
        best.count += 1;
        best.matched = true;
      } else {
        out.push({ pos, count: 1, seen: 0, matched: true });
      }
    }
    // Alle fund i den del af sangen, der blev hørt, har haft en chance mere for at blive hørt.
    for (const e of out) {
      if (e.pos <= heardTo) e.seen = (e.seen || 0) + 1;
      delete e.matched;
    }
    return out.sort((a, b) => a.pos - b.pos);
  }

  /**
   * Sangens hukommelse efter endnu en afspilning. `meta`: navn, kunstnere, varighed, genrer (fra Spotify).
   * Tempoet: tæt på det kendte (±4 %) gennemsnittes det; ellers vinder det, der er hørt flest gange.
   */
  function mergeSong(old, analysis, meta = {}) {
    const song = old ? JSON.parse(JSON.stringify(old)) : { plays: 0, bpm: null, bpmVotes: 0, drops: [], sections: [], builds: [], energy: [] };
    Object.assign(song, Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null)));
    song.plays += 1;
    if (analysis.bpm) {
      if (!song.bpm || Math.abs(analysis.bpm - song.bpm) / song.bpm <= 0.04) {
        song.bpm = Math.round(((song.bpm || 0) * song.bpmVotes + analysis.bpm) / (song.bpmVotes + 1) * 100) / 100;
        song.bpmVotes += 1;
      } else if (song.bpmVotes <= 1) {
        song.bpm = Math.round(analysis.bpm * 100) / 100; // ét svagt bud mod ét nyt: det nyeste
        song.bpmVotes = 1;
      } else {
        song.bpmVotes -= 1; // et andet bud svækker det kendte; vinder det igen og igen, tager det over
      }
    }
    song.drops = mergeEvents(song.drops, analysis.drops, MATCH.drop, analysis.heardTo);
    song.sections = mergeEvents(song.sections, analysis.sections, MATCH.section, analysis.heardTo);
    song.builds = mergeEvents(song.builds, analysis.builds, MATCH.build, analysis.heardTo);
    const energy = song.energy || [];
    analysis.energy.forEach((db, k) => {
      if (db === null || db === undefined) return;
      energy[k] = energy[k] === null || energy[k] === undefined ? db : Math.round(((energy[k] * (song.plays - 1) + db) / song.plays) * 10) / 10;
    });
    song.energy = energy;
    song.tags = songTags(song);
    song.updatedAt = new Date().toISOString();
    return song;
  }

  /**
   * De fund, man kan stole på: hørt i mindst halvdelen af gangene, sangen blev hørt så langt. Efter første
   * afspilning er alt, der blev hørt, med.
   */
  function knownEvents(song, kind) {
    const list = (song && song[kind === 'drop' ? 'drops' : kind === 'build' ? 'builds' : 'sections']) || [];
    return list.filter((e) => e.count / Math.max(1, e.seen || 1) >= 0.5).map((e) => e.pos);
  }

  /** Mærker ud fra Spotifys genrer og det, motoren hørte. */
  function songTags(song) {
    const tags = new Set((song.genres || []).map((g) => String(g).toLowerCase()));
    if (song.bpm) tags.add(song.bpm < 95 ? 'slow' : song.bpm > 135 ? 'fast' : 'mid-tempo');
    const levels = (song.energy || []).filter((x) => x !== null && x !== undefined);
    if (levels.length >= 4) {
      const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
      const spread = Math.max(...levels) - Math.min(...levels);
      if (spread >= 15) tags.add('dynamic');
      if (mean < -30) tags.add('quiet');
    }
    if (knownEvents(song, 'drop').length) tags.add('drops');
    if (knownEvents(song, 'build').length) tags.add('build-ups');
    return [...tags];
  }

  return { SongRecorder, mergeSong, knownEvents, songTags, MATCH };
});
