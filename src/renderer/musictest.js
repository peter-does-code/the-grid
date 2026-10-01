/*
 * `npm run musictest`: prøver hele analysekæden (Web Audio + musikmotor + instruktør) mod en
 * syntetisk sang med kendt facit. Kører i en OfflineAudioContext, så der kommer ingen lyd ud.
 *
 * Sangen: 128 BPM, første slag 0,25 s.
 *   0-16 s  vers        kick på hvert slag, hi-hat, svag pad
 *   16-32 s omkvæd      + lilletromme på 2 og 4, bas, tættere hi-hat, ca. 6 dB kraftigere
 *   32-36 s breakdown   kun pad, stille
 *   36-48 s drop        alt på én gang, kraftigst
 */
(function () {
  'use strict';

  const SR = 48000;
  const BPM = 128;
  const FIRST_BEAT = 0.25;
  const DURATION = 48;
  const FPS = 60;
  const BEAT = 60 / BPM;
  const PARTS = [
    { name: 'verse', from: 0, to: 16, kick: 0.9, snare: 0, hat: 0.12, hat16: false, bass: 0, pad: 0.1, gain: 0.3 },
    { name: 'chorus', from: 16, to: 32, kick: 1, snare: 0.7, hat: 0.3, hat16: true, bass: 0.35, pad: 0.12, gain: 0.45 },
    { name: 'breakdown', from: 32, to: 36, kick: 0, snare: 0, hat: 0, hat16: false, bass: 0, pad: 0.3, gain: 0.25 },
    { name: 'drop', from: 36, to: 48, kick: 1, snare: 0.8, hat: 0.35, hat16: true, bass: 0.45, pad: 0.12, gain: 0.85 },
  ];

  function partAt(t) {
    return PARTS.find((p) => t >= p.from && t < p.to) || PARTS[PARTS.length - 1];
  }

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** Lægger en lyd ind i bufferen fra tidspunktet `at`; `fn(t)` giver samplen t sekunder inde i lyden. */
  function add(data, at, seconds, fn) {
    const start = Math.round(at * SR);
    const end = Math.min(data.length, start + Math.round(seconds * SR));
    for (let i = Math.max(0, start); i < end; i++) data[i] += fn((i - start) / SR);
  }

  function synthesize() {
    const data = new Float32Array(SR * DURATION);
    const noise = seeded(42);
    let lastNoise = 0;
    const hiNoise = () => {
      const n = noise() * 2 - 1;
      const out = n - lastNoise; // første differens: kun diskant
      lastNoise = n;
      return out;
    };

    for (let k = 0; FIRST_BEAT + k * BEAT < DURATION; k++) {
      const t0 = FIRST_BEAT + k * BEAT;
      const p = partAt(t0);
      if (p.kick) {
        let phase = 0;
        add(data, t0, 0.35, (t) => {
          phase += (2 * Math.PI * (50 + 100 * Math.exp(-t * 30))) / SR;
          return Math.sin(phase) * Math.exp(-t * 9) * p.kick * p.gain;
        });
      }
      if (p.snare && k % 2 === 1) {
        add(data, t0, 0.25, (t) => ((noise() * 2 - 1) * 0.6 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * 190 * t) * 0.4 * Math.exp(-t * 25)) * p.snare * p.gain);
      }
      if (p.hat) {
        const steps = p.hat16 ? 4 : 2;
        for (let s = 0; s < steps; s++) {
          add(data, t0 + (s * BEAT) / steps, 0.08, (t) => hiNoise() * 0.5 * Math.exp(-t * 60) * p.hat * p.gain);
        }
      }
      if (p.bass) {
        const f = [55, 55, 65.4, 49][Math.floor(k / 4) % 4];
        add(data, t0, BEAT, (t) => {
          const w = 2 * Math.PI * f * t;
          return (Math.sin(w) + 0.5 * Math.sin(2 * w) + 0.25 * Math.sin(3 * w)) * 0.6 * Math.exp(-t * 3) * p.bass * p.gain;
        });
      }
    }
    // Pad: tre toner, med blød overgang mellem delene.
    for (let i = 0; i < data.length; i++) {
      const t = i / SR;
      const p = partAt(t);
      const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t)) / 3;
      data[i] += chord * p.pad * p.gain;
    }
    return data;
  }

  /**
   * Sang nummer to, med en opbygning som i dansemusik (128 BPM, første slag 0,25 s):
   *   0-16 s   intro       kick, bas, hi-hat
   *   16-32 s  opbygning   ingen kick eller bas; lilletrommehvirvel fra fjerdedele til 32.-dele,
   *                        en støj-"riser" og et niveau, der stiger jævnt
   *   32-44 s  drop        kick, bas, lilletromme og hi-hat på én gang
   */
  const BUILD_DURATION = 44;
  function synthesizeBuild() {
    const data = new Float32Array(SR * BUILD_DURATION);
    const noise = seeded(7);
    let last = 0;
    const hi = () => {
      const n = noise() * 2 - 1;
      const out = n - last;
      last = n;
      return out;
    };
    const kick = (t0, amp) => {
      let phase = 0;
      add(data, t0, 0.35, (t) => {
        phase += (2 * Math.PI * (50 + 100 * Math.exp(-t * 30))) / SR;
        return Math.sin(phase) * Math.exp(-t * 9) * amp;
      });
    };
    const bass = (t0, k, amp) => {
      const f = [55, 55, 65.4, 49][Math.floor(k / 4) % 4];
      add(data, t0, BEAT, (t) => Math.sin(2 * Math.PI * f * t) * 0.6 * Math.exp(-t * 3) * amp);
    };
    const snare = (t0, amp) => add(data, t0, 0.2, (t) => ((noise() * 2 - 1) * 0.6 * Math.exp(-t * 20) + Math.sin(2 * Math.PI * 190 * t) * 0.4 * Math.exp(-t * 25)) * amp);
    const hat = (t0, amp) => add(data, t0, 0.06, (t) => hi() * 0.5 * Math.exp(-t * 60) * amp);
    for (let k = 0; FIRST_BEAT + k * BEAT < BUILD_DURATION; k++) {
      const t0 = FIRST_BEAT + k * BEAT;
      if (t0 < 16) {
        kick(t0, 0.3);
        bass(t0, k, 0.12);
        for (let s = 0; s < 2; s++) hat(t0 + (s * BEAT) / 2, 0.05);
      } else if (t0 < 32) {
        const p = (t0 - 16) / 16; // 0 → 1 gennem opbygningen
        const steps = p < 0.25 ? 1 : p < 0.6 ? 2 : p < 0.85 ? 4 : 8;
        for (let s = 0; s < steps; s++) snare(t0 + (s * BEAT) / steps, (0.08 + 0.4 * p) * (0.4 + 0.6 * p));
      } else {
        kick(t0, 0.85);
        bass(t0, k, 0.45);
        if (k % 2 === 1) snare(t0, 0.5);
        for (let s = 0; s < 4; s++) hat(t0 + (s * BEAT) / 4, 0.18);
      }
    }
    // Riseren: højfrekvent støj, der vokser gennem opbygningen og stopper på droppet.
    for (let i = Math.round(16 * SR); i < Math.round(32 * SR); i++) {
      const p = (i / SR - 16) / 16;
      data[i] += hi() * 0.25 * p * p;
    }
    return data;
  }

  async function runBuildSong() {
    const samples = synthesizeBuild();
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: samples.length, sampleRate: SR });
    buffer.copyToChannel(samples, 0);
    const { events, actions } = await analyze(buffer);
    const builds = events.filter((e) => e.type === 'buildup').map((e) => Math.round(e.t * 100) / 100);
    const drops = events.filter((e) => e.type === 'drop').map((e) => Math.round(e.t * 100) / 100);
    const buildChanges = actions.filter((a) => a.reason === 'build').map((a) => Math.round(a.t * 100) / 100);
    const dropCut = actions.find((a) => a.reason === 'drop' && a.hard);
    return {
      builds,
      drops,
      buildChanges,
      dropCut: dropCut ? Math.round(dropCut.t * 100) / 100 : null,
      checks: {
        buildDetected: builds.length === 1 && builds[0] >= 18 && builds[0] < 31.5,
        buildDropDetected: drops.length === 1 && drops[0] >= 32 && drops[0] < 32.4,
        buildSpeedsUp: buildChanges.length >= 3,
        buildDropCut: Boolean(dropCut) && dropCut.t >= 32 && dropCut.t < 32.4,
      },
    };
  }

  function nearestBeatError(t) {
    const k = Math.round((t - FIRST_BEAT) / BEAT);
    return t - (FIRST_BEAT + k * BEAT);
  }

  function percentile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  }

  /** Kører musikmotor og instruktør over en AudioBuffer, billede for billede, uden at der høres noget. */
  async function analyze(buffer) {
    const started = performance.now();
    const duration = buffer.length / buffer.sampleRate;
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const music = new window.Visamp.MusicListener(ctx);
    music.connect(source);
    music.output.connect(ctx.destination); // offline: intet høres
    source.start(0);

    const director = new window.VisampMusic.PresetDirector({ random: seeded(7) });
    const cfg = { autoCycle: true, cycleSeconds: 20, blendSeconds: 2.7, beatSync: true, sectionChanges: true, hardCuts: true };
    const events = [];
    const actions = [];
    const bpmTimeline = [];
    const onsetCurve = [];
    let frameMs = 0;
    let frameCount = 0;

    for (let k = 1; k / FPS < duration - 0.05; k++) {
      const t = k / FPS;
      ctx.suspend(t).then(() => {
        const a = performance.now();
        const ev = music.frame(t);
        onsetCurve.push(music.engine.lastOnsetValue || 0);
        const state = music.engine.state;
        const action = director.update(t, ev, state, cfg);
        frameMs += performance.now() - a;
        frameCount += 1;
        for (const e of ev) events.push(e);
        if (action) actions.push({ t, ...action, onBeat: ev.some((e) => e.type === 'beat'), onDownbeat: ev.some((e) => e.type === 'beat' && e.downbeat) });
        if (k % FPS === 0) {
          bpmTimeline.push({
            t,
            bpm: state.bpm && Math.round(state.bpm * 10) / 10,
            conf: Math.round(state.confidence * 10) / 10,
            silent: state.silent,
            part: state.sectionIndex,
            energy: state.energy,
            gain: Math.round(music.agcGain * 100) / 100,
            // Tempo-kandidaterne i den seneste måling (til fejlsøgning af tempo-oktaven).
            candidates: music.engine.tempoCandidates || null,
            meter: music.engine.meter,
          });
        }
        ctx.resume();
      });
    }
    await ctx.startRendering();
    return {
      duration,
      events,
      actions,
      bpmTimeline,
      onsetCurve,
      performance: { frames: frameCount, avgFrameMs: Math.round((frameMs / frameCount) * 1000) / 1000, totalSeconds: Math.round((performance.now() - started) / 100) / 10 },
    };
  }

  async function runSynthetic() {
    const samples = synthesize();
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: samples.length, sampleRate: SR });
    buffer.copyToChannel(samples, 0);
    const { events, actions, bpmTimeline, performance: perf } = await analyze(buffer);

    // --- vurdering mod facit ---
    const inRange = (e, a, b) => e.t >= a && e.t < b;
    const bpms = bpmTimeline.filter((x) => x.t >= 10 && x.t <= 31 && x.bpm).map((x) => x.bpm);
    const medianBpm = percentile(bpms, 0.5);
    const beatErr = events.filter((e) => e.type === 'beat' && (inRange(e, 8, 31) || inRange(e, 40, 48))).map((e) => nearestBeatError(e.t));
    const absErr = beatErr.map(Math.abs);
    const within40 = absErr.filter((x) => x <= 0.04).length / (absErr.length || 1);
    const meanErr = beatErr.reduce((s, x) => s + x, 0) / (beatErr.length || 1);
    const parts = events.filter((e) => e.type === 'section' || e.type === 'drop').map((e) => ({ type: e.type, t: Math.round(e.t * 100) / 100, reason: e.reason }));
    // Sangen har ingen opbygning (breakdown er stille og flad), så motoren må ikke finde nogen.
    const buildups = events.filter((e) => e.type === 'buildup').map((e) => ({ ...e, t: Math.round(e.t * 100) / 100 }));
    const chorus = parts.filter((e) => e.type === 'section' && e.t >= 16.5 && e.t < 23);
    const drops = parts.filter((e) => e.type === 'drop' && e.t >= 36 && e.t < 36.6);
    const allowed = (e) => (e.t >= 16.5 && e.t < 23) || (e.t >= 32 && e.t < 36.6);
    const spurious = parts.filter((e) => !allowed(e));
    const softActions = actions.filter((a) => !a.hard);
    const syncedShare = softActions.filter((a) => a.onBeat).length / (softActions.length || 1);

    const checks = {
      tempo: medianBpm !== null && Math.abs(medianBpm - BPM) < 2,
      beats: within40 >= 0.85,
      chorusDetected: chorus.length === 1,
      dropDetected: drops.length === 1,
      noSpuriousParts: spurious.length === 0,
      changesOnBeat: syncedShare >= 0.8,
      noFalseBuildups: buildups.length === 0,
    };
    // Sang nummer to: en rigtig opbygning før et drop.
    const buildSong = await runBuildSong();
    Object.assign(checks, buildSong.checks);
    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      buildups,
      buildSong,
      tempo: { expected: BPM, median: medianBpm, timeline: bpmTimeline },
      beats: {
        count: beatErr.length,
        within40ms: Math.round(within40 * 1000) / 10,
        medianAbsMs: Math.round(percentile(absErr, 0.5) * 1000 * 10) / 10,
        p90AbsMs: Math.round(percentile(absErr, 0.9) * 1000 * 10) / 10,
        meanSignedMs: Math.round(meanErr * 1000 * 10) / 10,
      },
      parts,
      spurious,
      actions: actions.map((a) => ({ t: Math.round(a.t * 100) / 100, reason: a.reason, hard: a.hard, blend: Math.round(a.blendSeconds * 100) / 100, onDownbeat: a.onDownbeat })),
      performance: perf,
    };
  }

  /**
   * Uafhængigt tempoestimat over hele filen: autokorrelation af hele onset-kurven (60 Hz) i stedet
   * for motorens glidende 10-sekunders vindue. De stærkeste kandidater viser, hvad sangens tempo
   * sandsynligvis er, og om der er flere konkurrerende tempi (fx 2:1 eller 3:2).
   */
  function globalTempo(curve) {
    const n = curve.length;
    const mean = curve.reduce((s, x) => s + x, 0) / (n || 1);
    const env = curve.map((x) => x - mean);
    const acf = [];
    for (let L = 16; L <= 64; L++) {
      let s = 0;
      for (let i = L; i < n; i++) s += env[i] * env[i - L];
      acf[L] = s / (n - L);
    }
    const peaks = [];
    for (let L = 17; L < 64; L++) {
      if (acf[L] > acf[L - 1] && acf[L] >= acf[L + 1] && acf[L] > 0) {
        const denom = acf[L - 1] - 2 * acf[L] + acf[L + 1];
        const lag = L + (Math.abs(denom) > 1e-12 ? (0.5 * (acf[L - 1] - acf[L + 1])) / denom : 0);
        peaks.push({ bpm: Math.round((60 * FPS * 10) / lag) / 10, strength: acf[L] });
      }
    }
    const top = Math.max(...peaks.map((p) => p.strength), 1e-12);
    return peaks
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map((p) => ({ bpm: p.bpm, relative: Math.round((p.strength / top) * 100) / 100 }));
  }

  /** Bassens niveau (under ca. 120 Hz) i dB for hvert kvarte sekund; viser fx hvor bassen sætter ind. */
  function bassLevels(buffer, perSecond = 4) {
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const k = 1 - Math.exp((-2 * Math.PI * 120) / sr); // enpolet lavpas
    const step = Math.round(sr / perSecond);
    const out = [];
    let lp = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      lp += k * (data[i] - lp);
      sum += lp * lp;
      if ((i + 1) % step === 0) {
        out.push({ t: Math.round(((i + 1) / sr) * 100) / 100, db: Math.round(10 * Math.log10(sum / step + 1e-12) * 10) / 10 });
        sum = 0;
      }
    }
    return out;
  }

  /** En rigtig lydfil uden facit: rapportér hvad motoren hører, så det kan vurderes. */
  async function runFile(bytes) {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoder = new OfflineAudioContext(2, 1, 48000);
    const buffer = await decoder.decodeAudioData(data);
    const { duration, events, actions, bpmTimeline, onsetCurve, performance: perf } = await analyze(buffer);
    const beats = events.filter((e) => e.type === 'beat');
    const intervals = beats.slice(1).map((b, i) => b.t - beats[i].t);
    const meanInterval = intervals.reduce((s, x) => s + x, 0) / (intervals.length || 1);
    const sdInterval = Math.sqrt(intervals.reduce((s, x) => s + (x - meanInterval) ** 2, 0) / (intervals.length || 1));
    // Andel af slag, der kommer én periode efter det forrige (±10 %): viser om slagene er jævne.
    const regular = beats.slice(1).filter((b, i) => Math.abs(b.t - beats[i].t - 60 / b.bpm) <= 0.1 * (60 / b.bpm)).length;
    const bpms = bpmTimeline.filter((x) => x.bpm).map((x) => x.bpm);
    return {
      ok: true,
      mode: 'file',
      duration: Math.round(duration * 10) / 10,
      tempo: {
        median: percentile(bpms, 0.5),
        min: bpms.length ? Math.min(...bpms) : null,
        max: bpms.length ? Math.max(...bpms) : null,
        secondsWithTempo: bpms.length,
      },
      globalTempo: globalTempo(onsetCurve),
      beats: {
        count: beats.length,
        downbeats: beats.filter((b) => b.downbeat).length,
        regularPct: Math.round((regular / Math.max(1, beats.length - 1)) * 1000) / 10,
        intervalCvPct: Math.round((sdInterval / (meanInterval || 1)) * 1000) / 10,
      },
      events: events.filter((e) => e.type !== 'beat').map((e) => ({ type: e.type, t: Math.round(e.t * 100) / 100, reason: e.reason, rise: e.rise && Math.round(e.rise * 10) / 10 })),
      actions: actions.map((a) => ({ t: Math.round(a.t * 100) / 100, reason: a.reason, hard: a.hard, blend: Math.round(a.blendSeconds * 100) / 100, onDownbeat: a.onDownbeat })),
      timeline: bpmTimeline,
      bass: bassLevels(buffer),
      // Til beat-kort (fx for Init i påskeægget "drew"): slagene, som motoren hørte dem, og bassen hvert 10. ms.
      beatTimes: beats.map((b) => ({ t: Math.round(b.t * 1000) / 1000, down: Boolean(b.downbeat), bpm: b.bpm && Math.round(b.bpm * 10) / 10 })),
      bassFine: bassLevels(buffer, 100).map((x) => x.db),
      performance: perf,
    };
  }

  (async () => {
    const file = await window.visamp.musictest.getFile();
    return file ? runFile(file) : runSynthetic();
  })()
    .then((report) => window.visamp.musictest.report(report))
    .catch((err) => window.visamp.musictest.report({ ok: false, error: String((err && err.stack) || err) }));
})();
