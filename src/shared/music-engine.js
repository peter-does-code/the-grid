/*
 * Musikmotoren: lytter efter takt, tempo og sangens opbygning, så visualizeren følger musikken
 * som MilkDrop gjorde i Winamp. Skift sker på takten, ved nye dele af sangen og med hårde klip
 * på drops, og presets vælges efter hvilken del af musikken (bas, mellemtone, diskant) der fylder.
 *
 * Ren JavaScript uden DOM eller Web Audio: indlæses som <script> i rendereren (window.VisampMusic)
 * og via require() i tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampMusic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-12;

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /** Eksponentielt glidende gennemsnit med tidskonstant tau sekunder. */
  function ema(prev, value, dt, tau) {
    if (prev === null || prev === undefined || !Number.isFinite(prev)) return value;
    return prev + (value - prev) * (1 - Math.exp(-dt / tau));
  }

  function avg(list, pick) {
    if (!list.length) return 0;
    let s = 0;
    for (const item of list) s += pick(item);
    return s / list.length;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function sampleLinear(arr, pos) {
    if (pos <= 0) return arr[0];
    if (pos >= arr.length - 1) return arr[arr.length - 1];
    const i = Math.floor(pos);
    const f = pos - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  }

  // ---------------------------------------------------------------------------
  // Lydtræk pr. billede
  // ---------------------------------------------------------------------------

  // Samme bånd som Butterchurn/MilkDrop bruger til bass/mid/treb, plus et smalt kick-bånd til slag.
  const BANDS = {
    kick: [40, 130],
    bass: [20, 320],
    mid: [320, 2800],
    treb: [2800, 11025],
    flux: [30, 8000],
  };

  class FeatureExtractor {
    /**
     * @param {number} sampleRate
     * @param {number} fftSize analysatorens fftSize; spektret har fftSize/2 bins
     */
    constructor(sampleRate, fftSize) {
      const bins = fftSize / 2;
      this.binHz = sampleRate / fftSize;
      const toBin = (hz) => clamp(Math.round(hz / this.binHz), 1, bins - 1);
      this.ranges = {};
      for (const [name, [lo, hi]] of Object.entries(BANDS)) {
        const a = toBin(lo);
        this.ranges[name] = [a, Math.max(a + 1, toBin(hi))];
      }
      this.power = new Float64Array(bins);
      this.logMag = new Float64Array(bins);
      this.prevLogMag = null;
      this.prevLogKick = null;
    }

    /**
     * @param {Float32Array} db spektrum i dB (AnalyserNode.getFloatFrequencyData)
     * @param {number} rms tidsdomænets RMS (0..1)
     */
    extract(db, rms) {
      const n = Math.min(db.length, this.power.length);
      for (let i = 0; i < n; i++) {
        const v = db[i];
        const p = Number.isFinite(v) ? Math.pow(10, v / 10) : 0;
        this.power[i] = p;
        this.logMag[i] = Math.log(1 + 1000 * Math.sqrt(p));
      }
      const band = ([a, b]) => {
        let s = 0;
        for (let i = a; i < b; i++) s += this.power[i];
        return s;
      };
      const rmsDb = 20 * Math.log10(rms + 1e-9);
      const out = {
        rms,
        rmsDb,
        bass: band(this.ranges.bass),
        mid: band(this.ranges.mid),
        treb: band(this.ranges.treb),
        flux: 0,
        kickFlux: 0,
      };

      // Spektral flux: summen af stigninger i log-magnitude, dvs. hvor meget nyt der lige kom til.
      const [fa, fb] = this.ranges.flux;
      if (this.prevLogMag) {
        let s = 0;
        for (let i = fa; i < fb; i++) {
          const d = this.logMag[i] - this.prevLogMag[i];
          if (d > 0) s += d;
        }
        out.flux = s / (fb - fa);
      } else {
        this.prevLogMag = new Float64Array(this.logMag.length);
      }
      this.prevLogMag.set(this.logMag);

      const logKick = Math.log(band(this.ranges.kick) + EPS);
      if (this.prevLogKick !== null) out.kickFlux = Math.min(6, Math.max(0, logKick - this.prevLogKick));
      this.prevLogKick = logKick;

      // Støjgulvet i stille passager må ikke ligne slag.
      if (rmsDb < -60) {
        out.flux = 0;
        out.kickFlux = 0;
      }
      return out;
    }
  }

  // ---------------------------------------------------------------------------
  // Tempo, slag, dele af sangen og stilhed
  // ---------------------------------------------------------------------------

  const ENGINE_DEFAULTS = {
    gridRate: 100, // onset-kurven samples pr. sekund
    tempoWindowSec: 10,
    minBpm: 60,
    maxBpm: 190,
    tempoPriorBpm: 120,
    tempoPriorOctaves: 0.9,
    tempoMinConfidence: 1.8,
    onsetLatency: 0.027, // analysens forsinkelse fra lyd til målt onset (kalibreret med `npm run musictest`)
    // Hvornår lyd tæller som musik. Svag baggrundslyd fra andre programmer (-55 til -63 dB, målt)
    // må ikke vække visualizeren; når Spotify melder at der spilles på denne pc, er kun
    // digital stilhed "ingen musik".
    silenceDb: -48, // ingen oplysninger fra Spotify
    silenceDbPlaying: -70, // Spotify spiller på denne pc
    silenceDbPaused: -42, // Spotify er sat på pause eller spiller et andet sted
    sleepAfterSec: 2.0, // pauser i selve musikken må ikke slukke billedet
    sleepAfterPausedSec: 0.5, // når Spotify melder pause, slukkes hurtigt
    wakeAfterSec: 0.15,
    stickyTempo: 0.8, // behold tempoet, så længe det scorer mindst 80 % af den bedste kandidat
    stickyTempoThreeTwo: 0.55, // ... og 55 %, hvis kandidaten ligger i forholdet 3:2 eller 2:3
    octaveDownAboveBpm: 150, // over dette tempo foretrækkes det halve, hvis det er næsten lige så stærkt
    octaveDownShare: 0.35,
    octaveUpShare: 0.75, // under 75 BPM foretrækkes det dobbelte, hvis det er næsten lige så stærkt
    // Taktart-genkendelse (forsøg): fandt 10/4 i Radiohead for sent og gav falske 3 og 5 i Init og Febersvan,
    // så den er slået fra, og takten er 4 slag. Resten af motoren følger meter, når den slås til.
    meterDetect: false,
    meterHistoryBeats: 96, // slag, taktarten måles over
    meterMinBeats: 48,
    meterMaxShareOfFour: 0.3, // 4 slag må højst være så tydeligt som den bedste takt, før der skiftes
    stickyTempoOctave: 0.35, // væk fra oktaven nærmest 120 BPM: behold tempoet, så længe det scorer 35 %
    threeTwoTieShare: 0.85, // 3:2-kandidater så tæt på hinanden afgøres af det typiske tempo
    tempoInstantConfidence: 3.2, // så tydeligt et slag låses efter én måling
    // Sangens tempo: kandidaternes styrke lægges sammen hen over sangen (glemmes langsomt), så et tempo,
    // der har domineret længe, bliver sangens "typiske" tempo i stedet for de faste ca. 120 BPM. I sparsomme,
    // rolige passager (fx et 90-BPM-nummer i shuffle) vinder triolpulsen (120) eller 3:2-pulsen (135)
    // ellers ofte, og de bliver hængende.
    songTempoTauSec: 90,
    songTempoMinSec: 15, // så meget musik, før sangens tempo tæller
    songTempoTieShare: 0.8,
    // Efter en ny del eller et drop: så længe må et nyt tempo tage over efter to målinger, hvis det gamle
    // er faldet under denne andel af det nye.
    tempoFreeSec: 8,
    tempoFreeOldShare: 0.6,
    tempoFreeRivalShare: 0.75, // er sangens tempo så stærkt i forhold til den bedste kandidat, vælges det
    minSectionSec: 12,
    sectionThreshold: 1.6,
    dropRiseDb: 8,
    // Slag meldes så meget før det forudsagte tidspunkt, at billedet skifter samtidig med lyden, man hører:
    // lydfangsten og tegningen gør, at billedet ellers kommer lidt efter.
    beatLead: 0.04,
    // Opbygning før et drop: lydstyrken (eller tætheden af slag) stiger jævnt over buildWindowSec.
    buildWindowSec: 6,
    buildMinSlopeDb: 0.9, // dB pr. sekund
    buildMinR2: 0.8, // hvor jævn stigningen skal være (0-1)
    buildMinOnsetSlope: 0.6, // flere slag pr. sekund, pr. sekund (fx en trommehvirvel: 2 → 8-16 slag/s)
    buildMaxSec: 24,
    dropRiseDbAfterBuild: 4.5, // opbygningen løfter niveauet op til droppet; så skal springet være mindre
    dropRiseDbWithBass: 1.5, // ... og endnu mindre, hvis bassen samtidig kommer tilbage
    dropSuddenDb: 4, // et drop skal også ligge så meget over niveauet de sidste 1,5 s (et spring, ikke et crescendo)
    dropBassShareRise: 0.15, // bassens andel af båndene skal stige mindst så meget
    dropEarlySec: 20, // i sangens første sekunder (uden opbygning) ...
    dropEarlyExtraDb: 3, // ... skal springet være så meget større
    dropBelowSongDb: 2, // et drop uden opbygning må højst lande så langt under sangens normale niveau
    songLoudFadeDbPerSec: 0.05, // så hurtigt glemmes sangens kraftigste niveau (3 dB i minuttet)
  };

  class MusicEngine {
    constructor(options = {}) {
      this.o = { ...ENGINE_DEFAULTS, ...options };
      this.lastT = null;
      this.fluxMean = null;
      this.kickMean = null;
      this.silent = true; // indtil der kommer lyd
      this.playbackHint = null; // true/false når Spotify har meldt, om der spilles på denne pc
      this.quietSince = null;
      this.loudSince = null;
      this.silentStartedAt = 0;
      this.resetTempo();
      this.resetSong(0);
    }

    resetTempo() {
      const n = Math.round(this.o.gridRate * this.o.tempoWindowSec);
      this.grid = new Float32Array(n);
      this.kickGrid = new Float32Array(n);
      this.gridSlot = null;
      this.gridFilled = 0;
      this.prevGridValue = 0;
      this.prevKickValue = 0;
      this.tempo = { valid: false, bpm: 0, confidence: 0, pendingBpm: null, pendingCount: 0, lowCount: 0 };
      this.nextBeat = null;
      this.lastBeat = null;
      this.beatIndex = 0;
      this.lastTempoUpdate = -Infinity;
      this.resetBar();
      this.phaseMiss = 0;
    }

    /** Glemmer, hvor taktens første slag ligger (ny taktart, nyt tempo eller ny fase). */
    resetBar() {
      this.barAcc = new Array(this.meter || 4).fill(0);
      this.downbeatPhase = 0;
      this.beatStrengths = [];
    }

    /** Ny sang: glem sangens statistik og dele, men behold tempoet (det genfindes hurtigt). */
    resetSong(t) {
      this.songStart = t;
      this.snaps = [];
      this.snapAcc = null;
      this.lastSnapT = t;
      this.stats = { loud: null, loudVar: null, bass: null, mid: null, treb: null, onset: null };
      this.sectionIndex = 1;
      this.sectionStart = t;
      this.lastDrop = -Infinity;
      this.songLoudRef = null;
      this.fastPower = null;
      this.fastLoud = null;
      this.dropBaseline = null;
      this.onsets = [];
      this.onsetHist = [];
      this.pendingOnset = null;
      this.prevOnsetValue = 0;
      this.accent = { mean: null, var: null };
      this.build = { active: false, start: null, calmSince: null, peakLoud: null };
      this.cachedState = null;
      this.songAcc = null; // sangens tempo-evidens pr. periode (se songTempoTauSec)
      this.meter = 4; // slag pr. takt (se updateMeter)
      this.meterVote = null;
      this.resetBar();
      this.songAccSec = 0;
      this.tempoFreeUntil = -Infinity; // se tempoFreeSec
    }

    /** Sangens tempo som periode i pladser (null, indtil der er hørt nok). */
    songLag() {
      if (!this.songAcc || this.songAccSec < this.o.songTempoMinSec) return null;
      const acc = this.songAcc;
      let best = -1;
      let bestValue = 0;
      for (let L = 1; L < acc.length - 1; L++) {
        const v = acc[L - 1] + acc[L] + acc[L + 1];
        if (v > bestValue) {
          bestValue = v;
          best = L;
        }
      }
      if (best <= 0) return null;
      // Halvtid tæller som heltid: er det dobbelte tempo også godt repræsenteret, er det sangens tempo.
      const R = this.o.gridRate;
      const half = Math.round(best / 2);
      if (2 * ((60 * R) / best) <= this.o.octaveDownAboveBpm && half >= 1) {
        const v = acc[half - 1] + acc[half] + acc[half + 1];
        if (v >= 0.5 * bestValue) return half;
      }
      return best;
    }

    /** Kaldes, når Spotify melder et nyt nummer. */
    notifyTrackChange(t) {
      this.resetTempo();
      this.resetSong(t);
    }

    /** true: Spotify spiller på denne pc. false: pause eller et andet sted. null: ukendt. */
    setPlaybackHint(playing) {
      this.playbackHint = playing === true ? true : playing === false ? false : null;
    }

    silenceThreshold() {
      if (this.playbackHint === true) return this.o.silenceDbPlaying;
      if (this.playbackHint === false) return this.o.silenceDbPaused;
      return this.o.silenceDb;
    }

    /**
     * Et billede med lydtræk. Returnerer hændelser:
     *   beat    {t, index, downbeat, bpm}
     *   accent  {t, strengthZ}      kraftigt slag (til MilkDrops hårde klip)
     *   section {t, index, reason}  ny del af sangen
     *   drop    {t, index, rise}    pludselig kraftig stigning efter en roligere del
     *   sleep / wake                musikken stoppede / startede
     */
    update(t, f) {
      const events = [];
      if (this.lastT !== null && t - this.lastT > 0.75) this.resetTempo(); // fx minimeret vindue
      const dt = this.lastT === null ? 1 / 60 : clamp(t - this.lastT, 1e-3, 0.25);
      this.lastT = t;

      this.updateSilence(t, f, events);
      const quiet = f.rmsDb < this.silenceThreshold();

      const flux = quiet ? 0 : f.flux;
      const kick = quiet ? 0 : f.kickFlux;
      this.fluxMean = ema(this.fluxMean, flux, dt, 2);
      this.kickMean = ema(this.kickMean, kick, dt, 2);
      const onset = Math.min(20, (0.5 * flux) / (this.fluxMean + 1e-4) + (0.5 * kick) / (this.kickMean + 1e-4));
      const kickOnset = Math.min(20, kick / (this.kickMean + 1e-4));
      this.lastOnsetValue = onset;
      this.pushGrid(t, onset, kickOnset);
      this.detectOnset(t, onset, events);

      if (!this.silent && t - this.lastTempoUpdate >= 0.5 && this.gridFilled >= this.o.gridRate * 4) {
        this.lastTempoUpdate = t;
        this.updateTempo(t);
      }
      if (this.tempo.valid && this.nextBeat !== null && !this.silent) {
        // Slaget meldes beatLead før sit tidspunkt (hændelsens t er stadig det forudsagte slag).
        for (let guard = 0; t >= this.nextBeat - this.o.beatLead && guard < 8; guard++) events.push(this.emitBeat());
      }

      this.updateSections(t, dt, f, quiet, events);
      return events;
    }

    updateSilence(t, f, events) {
      const quiet = f.rmsDb < this.silenceThreshold();
      if (quiet) {
        this.loudSince = null;
        if (this.quietSince === null) this.quietSince = t;
        const sleepAfter = this.playbackHint === false ? this.o.sleepAfterPausedSec : this.o.sleepAfterSec;
        if (!this.silent && t - this.quietSince >= sleepAfter) {
          this.silent = true;
          this.silentStartedAt = t;
          this.resetTempo();
          this.cachedState = null;
          events.push({ type: 'sleep', t });
        }
      } else {
        this.quietSince = null;
        if (this.loudSince === null) this.loudSince = t;
        if (this.silent && t - this.loudSince >= this.o.wakeAfterSec) {
          this.silent = false;
          // Efter en længere pause er det typisk en ny sang.
          if (t - this.silentStartedAt >= 3) this.resetSong(t);
          this.cachedState = null;
          events.push({ type: 'wake', t });
        }
      }
    }

    // --- onset-kurve (til tempo) ---

    pushGrid(t, value, kickValue) {
      const n = this.grid.length;
      const slot = Math.floor(t * this.o.gridRate);
      if (this.gridSlot === null) {
        this.gridSlot = slot;
        this.grid[slot % n] = value;
        this.kickGrid[slot % n] = kickValue;
        this.gridFilled = 1;
      } else if (slot > this.gridSlot) {
        // Sample-and-hold: pladserne mellem to billeder beholder den forrige værdi, så timingen bevares.
        const steps = Math.min(slot - this.gridSlot, n);
        for (let s = slot - steps + 1; s < slot; s++) {
          this.grid[s % n] = this.prevGridValue;
          this.kickGrid[s % n] = this.prevKickValue;
        }
        this.grid[slot % n] = value;
        this.kickGrid[slot % n] = kickValue;
        this.gridFilled = Math.min(n, this.gridFilled + (slot - this.gridSlot));
        this.gridSlot = slot;
      } else {
        const i = ((slot % n) + n) % n;
        if (value > this.grid[i]) this.grid[i] = value;
        if (kickValue > this.kickGrid[i]) this.kickGrid[i] = kickValue;
      }
      this.prevGridValue = value;
      this.prevKickValue = kickValue;
    }

    /** De seneste `count` pladser i tidsrækkefølge. */
    envelope(grid, count) {
      const n = grid.length;
      const out = new Float64Array(count);
      const start = this.gridSlot - count + 1;
      for (let i = 0; i < count; i++) out[i] = grid[(((start + i) % n) + n) % n];
      return out;
    }

    gridMaxNear(grid, time, halfWidth) {
      if (this.gridSlot === null) return 0;
      const n = grid.length;
      const oldest = this.gridSlot - this.gridFilled + 1;
      const a = Math.max(oldest, Math.floor((time - halfWidth) * this.o.gridRate));
      const b = Math.min(this.gridSlot, Math.floor((time + halfWidth) * this.o.gridRate));
      let max = 0;
      for (let s = a; s <= b; s++) max = Math.max(max, grid[((s % n) + n) % n]);
      return max;
    }

    detectOnset(t, value, events) {
      this.onsetHist.push(value);
      if (this.onsetHist.length > 60) this.onsetHist.shift();
      const threshold = Math.max(1.5, median(this.onsetHist) * 1.6 + 0.5);

      const p = this.pendingOnset;
      if (p) {
        p.peak = Math.max(p.peak, value);
        p.frames += 1;
        if (p.frames >= 3 || value < threshold) this.finishOnset(p, events);
      } else if (value > threshold && this.prevOnsetValue <= threshold && t - (this.onsets[this.onsets.length - 1] || -1) > 0.1) {
        this.pendingOnset = { t, peak: value, frames: 0 };
      }
      this.prevOnsetValue = value;
      while (this.onsets.length && this.onsets[0] < t - 4) this.onsets.shift();
    }

    finishOnset(p, events) {
      this.pendingOnset = null;
      this.onsets.push(p.t);
      const a = this.accent;
      a.mean = a.mean === null ? p.peak : a.mean * 0.95 + p.peak * 0.05;
      const dev = p.peak - a.mean;
      a.var = a.var === null ? dev * dev + 1 : a.var * 0.95 + dev * dev * 0.05;
      const z = dev / Math.sqrt(a.var + 1e-6);
      if (!this.tempo.valid) return;
      const period = 60 / this.tempo.bpm;
      const nearBeat =
        (this.lastBeat !== null && Math.abs(p.t - this.lastBeat) < 0.07) ||
        (this.nextBeat !== null && Math.abs(this.nextBeat - p.t) < 0.07 && period > 0);
      if (nearBeat && z > 2.5) events.push({ type: 'accent', t: p.t, strengthZ: z });
    }

    updateTempo(t) {
      const R = this.o.gridRate;
      const n = this.gridFilled;
      const raw = this.envelope(this.grid, n);

      // Let udglatning og nulmiddelværdi før autokorrelation.
      const env = new Float64Array(n);
      for (let i = 0; i < n; i++) env[i] = (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(n - 1, i + 1)]) / 3;
      let m = 0;
      for (let i = 0; i < n; i++) m += env[i];
      m /= n;
      for (let i = 0; i < n; i++) env[i] -= m;

      const minLag = Math.floor((R * 60) / this.o.maxBpm);
      const maxLag = Math.ceil((R * 60) / this.o.minBpm);
      const topLag = Math.min(4 * maxLag + 1, n - 2 * R);
      if (topLag <= minLag + 2) return;
      // Periodens dobbelte og firdobbelte (takten) tæller med, men kun når de kan måles for alle
      // kandidater, så langsomme tempi ikke stilles dårligere, mens der endnu er lidt data.
      const useDouble = 2 * maxLag <= topLag;
      const useBar = 4 * maxLag <= topLag;
      const acf = new Float64Array(topLag + 2);
      for (let L = minLag; L <= topLag; L++) {
        let s = 0;
        for (let i = L; i < n; i++) s += env[i] * env[i - L];
        acf[L] = s / (n - L);
      }
      const acfAt = (x) => sampleLinear(acf, Math.min(x, topLag));

      // Harmonisk forstærkning: et rigtigt slag gentager sig også efter 2 og 4 slag (en takt), mens
      // f.eks. en triol-puls ikke passer ind i taktens mønster. Plus en blød forventning om ca. 120 BPM,
      // så dobbelt/halvt tempo sjældnere vinder.
      const lastLag = Math.min(maxLag, topLag);
      const scores = [];
      for (let L = minLag; L <= lastLag; L++) {
        const bpm = (60 * R) / L;
        const octaves = Math.log2(bpm / this.o.tempoPriorBpm) / this.o.tempoPriorOctaves;
        const prior = Math.exp(-0.5 * octaves * octaves);
        const harmonic = acf[L] + (useDouble ? 0.5 * acfAt(2 * L) : 0) + (useBar ? 0.25 * acfAt(4 * L) : 0);
        scores.push({ L, score: harmonic * prior });
      }
      let best = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i].score > scores[best].score) best = i;
      {
        const top = scores[best].score;
        if (top > 0) {
          if (!this.songAcc || this.songAcc.length !== lastLag + 2) this.songAcc = new Float64Array(lastLag + 2);
          const decay = Math.exp(-0.5 / this.o.songTempoTauSec);
          for (let L = 0; L < this.songAcc.length; L++) this.songAcc[L] *= decay;
          // Over ca. 150 BPM er det typisk hi-hatten; den tæller med for det halve tempo (slaget).
          const fastLag = (60 * R) / this.o.octaveDownAboveBpm;
          for (const s of scores) {
            if (s.score <= 0) continue;
            const L = s.L < fastLag && 2 * s.L <= lastLag ? 2 * s.L : s.L;
            this.songAcc[L] += s.score / top;
          }
          this.songAccSec += 0.5;
        }
      }
      const songLag = this.songLag();
      const songBpm = songLag ? (60 * R) / songLag : null;
      // Det typiske tempo: sangens eget, når det kendes, ellers de faste ca. 120 BPM.
      const typicalBpm = songBpm || this.o.tempoPriorBpm;
      const mean = avg(scores, (s) => s.score);
      const sd = Math.sqrt(avg(scores, (s) => (s.score - mean) ** 2)) + 1e-9;
      const confidence = (scores[best].score - mean) / sd;

      // Tempo-oktav: over ca. 150 BPM er vinderen typisk hi-hatten (ottendedele), ikke slaget. Er det
      // halve tempo næsten lige så stærkt, er det slaget. (Init: 185 i stedet for 93 BPM de første 12 s.)
      const bestBpm = (60 * R) / scores[best].L;
      {
        // De tre stærkeste lokale toppe, til fejlsøgning (musiktestens tidslinje).
        const peaks = scores.filter((s, i) => i > 0 && i < scores.length - 1 && s.score >= scores[i - 1].score && s.score >= scores[i + 1].score);
        peaks.sort((a, b) => b.score - a.score);
        const top = scores[best].score || 1;
        this.tempoCandidates = peaks.slice(0, 4).map((p) => [Math.round((60 * R) / p.L), Math.round((100 * p.score) / top)]);
        this.tempoPeaks = peaks;
      }
      if (bestBpm > this.o.octaveDownAboveBpm) {
        const half = this.localPeak(scores, 2 * scores[best].L);
        if (half && half.score >= this.o.octaveDownShare * scores[best].score) {
          const k = scores.findIndex((s) => Math.abs(s.L - half.lag) < 1);
          if (k >= 0) best = k;
        }
      } else if (2 * bestBpm <= this.o.octaveDownAboveBpm) {
        // Omvendt: et langsomt tempo, hvis dobbelte næsten er lige så stærkt, er typisk halvtid (trommerne
        // spiller halvt så tæt i en del af sangen). Det dobbelte er slaget, man mærker (Febersvan: 65/130).
        const double = this.localPeak(scores, scores[best].L / 2);
        if (double && double.score >= this.o.octaveUpShare * scores[best].score) {
          const k = scores.findIndex((s) => Math.abs(s.L - double.lag) < 1);
          if (k >= 0) best = k;
        }
      }
      // 3:2-uafgjort: er en kandidat i forholdet 3:2 eller 2:3 næsten lige så stærk, vælges den, der ligger
      // tættest på det typiske tempo (Init ved 12 s: 63 BPM mod 92 BPM med 89 % af styrken).
      {
        const distance = (lagSlots) => Math.abs(Math.log2((60 * R) / lagSlots / typicalBpm));
        // Er sangens tempo næsten lige så stærkt som vinderen, er det sangens tempo (uanset forhold).
        const song = songLag && Math.abs(scores[best].L - songLag) / songLag >= 0.04 ? this.localPeak(scores, songLag) : null;
        const songWins = song && song.score >= this.o.songTempoTieShare * scores[best].score;
        if (songWins) {
          const k = scores.findIndex((s) => Math.abs(s.L - song.lag) < 1);
          if (k >= 0) best = k;
        }
        for (const factor of songWins ? [] : [2 / 3, 3 / 2]) {
          const alt = this.localPeak(scores, factor * scores[best].L);
          if (alt && alt.score >= this.o.threeTwoTieShare * scores[best].score && distance(alt.lag) < distance(scores[best].L)) {
            const k = scores.findIndex((s) => Math.abs(s.L - alt.lag) < 1);
            if (k >= 0) {
              best = k;
              break;
            }
          }
        }
      }

      // Parabolsk interpolation giver tempoet med brøkdele af en plads.
      let lag = scores[best].L;
      if (best > 0 && best < scores.length - 1) {
        const a = scores[best - 1].score;
        const b = scores[best].score;
        const c = scores[best + 1].score;
        const denom = a - 2 * b + c;
        if (Math.abs(denom) > 1e-12) lag += clamp((0.5 * (a - c)) / denom, -0.5, 0.5);
      }
      const bpm = (60 * R) / lag;
      const T = this.tempo;
      T.confidence = confidence;

      if (confidence < this.o.tempoMinConfidence || scores[best].score <= 0) {
        T.lowCount += 1;
        if (T.lowCount >= 4) T.valid = false;
        return;
      }
      T.lowCount = 0;
      const close = (x, y) => Math.abs(x - y) / y < 0.04;

      if (!T.valid) {
        if (T.pendingBpm !== null && close(bpm, T.pendingBpm)) T.pendingCount += 1;
        else {
          T.pendingBpm = bpm;
          T.pendingCount = 1;
        }
        // Et meget tydeligt slag låses med det samme; ellers skal to målinger i træk være enige.
        if (T.pendingCount >= 2 || confidence >= this.o.tempoInstantConfidence) {
          T.valid = true;
          T.bpm = bpm;
          T.pendingBpm = null;
          T.pendingCount = 0;
          this.startBeats(t, raw);
        }
        return;
      }

      if (close(bpm, T.bpm)) {
        T.bpm = T.bpm * 0.8 + bpm * 0.2;
        T.pendingBpm = null;
        T.pendingCount = 0;
      } else {
        // Musik rummer ofte flere tempi på én gang (fx 80 og 120 BPM ved trioler). Er det nuværende
        // tempo stadig stærkt, bliver vi ved det og følger kun små ændringer omkring det.
        const current = this.localPeak(scores, (60 * R) / T.bpm);
        // En kandidat i forholdet 3:2 eller 2:3 (fx 62 mod 93 BPM) er typisk en synkoperet baslinje eller
        // trioler, ikke et nyt tempo: den skal være klart stærkere og holde længere, før der skiftes.
        // Kun når det nuværende tempo ligger tættest på det typiske (ca. 120 BPM); ellers skal kandidaten
        // tværtimod vinde hurtigere (Init: 62 BPM før 93 BPM).
        const ratio = bpm / T.bpm;
        const isThreeTwo = Math.abs(ratio - 1.5) < 0.06 || Math.abs(ratio - 2 / 3) < 0.04;
        const distance = (x) => Math.abs(Math.log2(x / typicalBpm));
        // Tilbage til sangens tempo går hurtigt, uanset forholdet (fx 120 → 90 BPM efter en rolig passage).
        const towardSong = songBpm !== null && close(bpm, songBpm) && !close(T.bpm, songBpm);
        const threeTwo = isThreeTwo && !towardSong && distance(T.bpm) <= distance(bpm);
        // En oktav (2:1): skift mellem halvtid og heltid i sangens dele. Væk fra oktaven nærmest de typiske
        // ca. 120 BPM skal det nuværende være næsten forsvundet og holde længe; derhen går det hurtigt.
        const isOctave = Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 0.5) < 0.02;
        const prior = (x) => Math.abs(Math.log2(x / this.o.tempoPriorBpm));
        const octaveAway = isOctave && prior(T.bpm) <= prior(bpm);
        const towardTypical = !octaveAway && (towardSong || (isThreeTwo && !threeTwo) || isOctave);
        const sticky = octaveAway ? this.o.stickyTempoOctave : threeTwo ? this.o.stickyTempoThreeTwo : towardTypical ? 1 : this.o.stickyTempo;
        // Lige efter en ny del af sangen eller et drop må et nyt tempo tage over med det samme, hvis det gamle
        // tydeligt er væk: sange, der skifter tempo, skifter det typisk sammen med en ny del.
        // Ikke til et simpelt forhold af det nuværende (2:1 ±7 %, 3:2 og 4:3 ±4 %, og omvendt): det er de klassiske
        // tvetydigheder (halvtid, trioler, synkoper), ikke et nyt tempo.
        const simple = (x) =>
          [2, 1 / 2].some((r) => Math.abs(x / r - 1) < 0.07) || [3 / 2, 2 / 3, 4 / 3, 3 / 4].some((r) => Math.abs(x / r - 1) < 0.04);
        // ... og det nye tempo skal stå klart: ingen anden, ubeslægtet kandidat må være næsten lige så stærk
        // (i en rodet overgang er der flere halvstærke kandidater, efter et rigtigt tempo-skift én).
        const winnerLag = scores[best].L;
        const currentLag = (60 * R) / T.bpm;
        const rival = (this.tempoPeaks || []).find(
          (p) => Math.abs(p.L - winnerLag) / winnerLag > 0.04 && Math.abs(p.L - currentLag) / currentLag > 0.04 && !simple(winnerLag / p.L)
        );
        const clear = !rival || rival.score <= this.o.tempoFreeRivalShare * scores[best].score;
        const free =
          t < this.tempoFreeUntil && !simple(ratio) && clear && (!current || current.score < this.o.tempoFreeOldShare * scores[best].score);
        if (!free && current && current.score >= sticky * scores[best].score) {
          T.bpm = T.bpm * 0.8 + ((60 * R) / current.lag) * 0.2;
          T.pendingBpm = null;
          T.pendingCount = 0;
        } else {
          if (T.pendingBpm !== null && close(bpm, T.pendingBpm)) T.pendingCount += 1;
          else {
            T.pendingBpm = bpm;
            T.pendingCount = 1;
          }
          // Væk fra sangens tempo (fx i et break, hvor slaget forsvinder) kræver lige så lang tid som 3:2.
          const awayFromSong = songBpm !== null && close(T.bpm, songBpm);
          const needed = free ? 2 : threeTwo || octaveAway || awayFromSong ? 12 : towardTypical ? 3 : 6;
          if (T.pendingCount >= needed) {
            T.bpm = bpm;
            T.pendingBpm = null;
            T.pendingCount = 0;
            this.resetBar();
            // Et nyt tempo i en ny del: sangens tempo-hukommelse svækkes, så den ikke trækker tilbage til det gamle.
            if (free && this.songAcc) for (let L = 0; L < this.songAcc.length; L++) this.songAcc[L] *= 0.3;
          }
        }
      }
      this.correctPhase(raw);
    }

    /** Den højeste score inden for ±4 % af en given periode (i pladser). */
    localPeak(scores, lag) {
      let best = null;
      for (const s of scores) {
        if (Math.abs(s.L - lag) / lag < 0.04 && (!best || s.score > best.score)) best = s;
      }
      if (!best) return null;
      // Brøkdel af en plads, som i hovedsøgningen.
      const i = scores.indexOf(best);
      let refined = best.L;
      if (i > 0 && i < scores.length - 1) {
        const a = scores[i - 1].score;
        const c = scores[i + 1].score;
        const denom = a - 2 * best.score + c;
        if (Math.abs(denom) > 1e-12) refined += clamp((0.5 * (a - c)) / denom, -0.5, 0.5);
      }
      return { score: best.score, lag: refined };
    }

    /** Tidspunktet for det seneste slag, fundet som den fase der rammer flest onsets de sidste 4 s. */
    measurePhase(raw) {
      const R = this.o.gridRate;
      const n = raw.length;
      const period = (60 * R) / this.tempo.bpm;
      // Mindst 4 s og mindst 8 slag: i langsomme, sparsomme passager er 4 s kun få slag, og et enkelt
      // synkoperet anslag kan så trække fasen.
      const span = Math.min(n, Math.round(Math.max(4 * R, 8 * period)));
      let best = -Infinity;
      let bestPhase = 0;
      for (let ph = 0; ph < period; ph += 0.5) {
        let s = 0;
        let c = 0;
        for (let pos = n - 1 - ph; pos >= n - span; pos -= period) {
          s += sampleLinear(raw, pos);
          c += 1;
        }
        s /= c || 1;
        if (s > best) {
          best = s;
          bestPhase = ph;
        }
      }
      const newestSlotTime = (this.gridSlot + 0.5) / R;
      return newestSlotTime - bestPhase / R - this.o.onsetLatency;
    }

    startBeats(t, raw) {
      const period = 60 / this.tempo.bpm;
      let next = this.measurePhase(raw) + period;
      while (next <= t) next += period;
      this.nextBeat = next;
      this.lastBeat = next - period;
      this.beatIndex = 0;
      this.resetBar();
      this.phaseMiss = 0;
    }

    /** Faselåst sløjfe: små fejl rettes blidt, en vedvarende stor fejl giver et spring. */
    correctPhase(raw) {
      if (this.nextBeat === null) return;
      const period = 60 / this.tempo.bpm;
      const measured = this.measurePhase(raw);
      const diff = (((measured - this.nextBeat) % period) + 1.5 * period) % period - period / 2;
      if (Math.abs(diff) < 0.12 * period) {
        this.nextBeat += 0.3 * diff;
        this.phaseMiss = 0;
        return;
      }
      // Et spring kun, når målingerne er enige om den nye fase (ikke når et par løse anslag trækker hver sin vej).
      const agrees = this.phaseMiss > 0 && Math.abs(diff - this.phaseMissDiff) < 0.1 * period;
      this.phaseMiss = agrees ? this.phaseMiss + 1 : 1;
      this.phaseMissDiff = diff;
      // Et spring på en tredjedel af et slag er typisk triolens sidste node i et shuffle, ikke et nyt slag:
      // det skal holde dobbelt så længe.
      const triplet = Math.abs(Math.abs(diff) - period / 3) < 0.07 * period;
      if (this.phaseMiss >= (triplet ? 6 : 3)) {
        this.nextBeat += diff;
        this.phaseMiss = 0;
      }
    }

    emitBeat() {
      const period = 60 / this.tempo.bpm;
      const beatTime = this.nextBeat;
      const index = this.beatIndex++;
      this.lastBeat = beatTime;
      this.nextBeat = beatTime + period;

      // Styrken på det forrige slag er nu fuldt målt; brug den til at finde taktens første slag.
      if (index > 0) {
        const M = this.meter;
        const prevPhase = (index - 1) % M;
        const strength = this.gridMaxNear(this.kickGrid, beatTime - period + this.o.onsetLatency, 0.05);
        this.barAcc[prevPhase] = this.barAcc[prevPhase] * 0.8 + strength;
        let bestPhase = this.downbeatPhase;
        for (let i = 0; i < M; i++) if (this.barAcc[i] > this.barAcc[bestPhase] * 1.15) bestPhase = i;
        this.downbeatPhase = bestPhase;
        this.beatStrengths.push({ index: index - 1, strength });
        if (this.beatStrengths.length > this.o.meterHistoryBeats) this.beatStrengths.shift();
        if (this.o.meterDetect && index % 8 === 0) this.updateMeter();
      }
      return { type: 'beat', t: beatTime, index, downbeat: index % this.meter === this.downbeatPhase, bpm: this.tempo.bpm };
    }

    /**
     * Taktarten: hvor mange slag, før mønsteret af kraftige og svage slag gentager sig. Autokorrelation af
     * slagenes styrke over 3-12 slag. Der skiftes kun væk fra 4 (det almindelige), når 4 tydeligt ikke passer,
     * og to målinger i træk er enige (Radiohead, "Everything In Its Right Place": 10).
     */
    updateMeter() {
      const hist = this.beatStrengths;
      if (hist.length < this.o.meterMinBeats) return;
      const x = hist.map((h) => h.strength);
      const mean = x.reduce((a, b) => a + b, 0) / x.length;
      const z = x.map((v) => v - mean);
      const c = [];
      for (let lag = 0; lag <= 12; lag++) {
        let sum = 0;
        for (let i = lag; i < z.length; i++) sum += z[i] * z[i - lag];
        c[lag] = sum / (z.length - lag);
      }
      let top = 3;
      for (let lag = 4; lag <= 12; lag++) if (c[lag] > c[top]) top = lag;
      // Dobbelttakter tæller for den enkelte takt, når den er næsten lige så tydelig.
      let M = top;
      if (M % 4 === 0 || M === 11) M = 4;
      else if (M === 9) M = 3;
      else if ((M === 6 || M === 10) && c[M / 2] >= 0.8 * c[M]) M /= 2;
      const clear = c[top] > 0.25 * c[0] && c[4] <= this.o.meterMaxShareOfFour * c[top] && c[8] <= 0.5 * c[top];
      const vote = M !== 4 && clear ? M : 4;
      if (vote === this.meterVote && vote !== this.meter) {
        this.meter = vote;
        // Find taktens første slag igen ud fra historikken: den fase, hvor slagene er kraftigst.
        const acc = new Array(vote).fill(0);
        for (const h of hist) acc[h.index % vote] = acc[h.index % vote] * 0.8 + h.strength;
        this.barAcc = acc;
        let best = 0;
        for (let i = 1; i < vote; i++) if (acc[i] > acc[best]) best = i;
        this.downbeatPhase = best;
      }
      this.meterVote = vote;
    }

    // --- dele af sangen ---

    window(from, to) {
      return this.snaps.filter((s) => s.t >= from && s.t < to);
    }

    updateSections(t, dt, f, quiet, events) {
      // Kortvarig lydstyrke som gennemsnit af effekt over ca. et slag: et enkelt kraftigt kick
      // løfter den kun få dB, mens et rigtigt drop løfter den med det samme.
      this.fastPower = ema(this.fastPower === undefined ? null : this.fastPower, f.rms * f.rms, dt, 0.2);
      this.fastLoud = 10 * Math.log10(this.fastPower + EPS);
      const bands = f.bass + f.mid + f.treb;
      if (bands > 0) this.fastBassShare = ema(this.fastBassShare === undefined ? null : this.fastBassShare, f.bass / bands, dt, 0.2);

      // Drop: tjekkes hvert billede, så det hårde klip kommer med det samme. Basislinjen er medianen af
      // de sidste 1-6 sekunder, så et spring kræver mindst et par sekunders roligere musik forinden.
      if (!this.silent && !quiet && this.dropBaseline !== null && t - this.lastDrop > 10) {
        // Under en opbygning stiger niveauet jævnt; droppet måles mod det seneste niveau (det højeste i de
        // sidste 1,5 s), så rampen i sig selv aldrig ligner et drop.
        const baseline = this.build.active && this.buildBaseline !== null ? this.buildBaseline : this.dropBaseline;
        const rise = this.fastLoud - baseline;
        const threshold = this.build.active ? this.o.dropRiseDbAfterBuild : this.o.dropRiseDb;
        // Efter en opbygning er bassen ofte filtreret væk og kommer tilbage på droppet: et mindre spring
        // i niveauet er nok, hvis bassens andel samtidig stiger tydeligt.
        const bassReturns =
          this.build.active &&
          this.buildBassShare !== null &&
          rise > this.o.dropRiseDbWithBass &&
          this.fastBassShare - this.buildBassShare > this.o.dropBassShareRise;
        // Et drop er et spring, ikke et crescendo: niveauet skal også ligge klart over de sidste 1,5 s.
        // (Ellers kunne en trommehvirvel, der bliver kraftigere, ligne et drop.)
        const sudden = this.buildBaseline === null || this.fastLoud - this.buildBaseline > this.o.dropSuddenDb;
        // Uden opbygning: et drop lander på mindst sangens normale niveau (at musikken vender tilbage efter
        // en stille passage er ikke et drop), og i en rolig intro, hvor instrumenterne kommer ind ét ad
        // gangen, skal springet være større.
        const early = t - this.songStart < this.o.dropEarlySec;
        const loudEnough =
          this.build.active || this.songLoudRef === null || early || this.fastLoud >= this.songLoudRef - this.o.dropBelowSongDb;
        const needed = threshold + (early && !this.build.active ? this.o.dropEarlyExtraDb : 0);
        if ((rise > needed && sudden && loudEnough) || bassReturns) {
          this.lastDrop = t;
          this.sectionIndex += 1;
          this.sectionStart = t;
          this.cachedState = null;
          const afterBuild = this.build.active;
          if (afterBuild) this.endBuild(t, events, 'drop');
          events.push({ type: 'drop', t, index: this.sectionIndex, rise, afterBuild });
          this.tempoFreeUntil = t + this.o.tempoFreeSec;
        }
      }

      const acc = this.snapAcc || (this.snapAcc = { power: 0, bass: 0, mid: 0, treb: 0, n: 0 });
      acc.power += f.rms * f.rms;
      acc.bass += f.bass;
      acc.mid += f.mid;
      acc.treb += f.treb;
      acc.n += 1;
      if (t - this.lastSnapT < 0.25) return;
      this.lastSnapT = t;
      this.snapAcc = null;
      if (quiet || this.silent) return; // stilhed tæller ikke med i sangens profil

      const snap = {
        t,
        loud: 10 * Math.log10(acc.power / acc.n + EPS),
        bass: acc.bass / acc.n,
        mid: acc.mid / acc.n,
        treb: acc.treb / acc.n,
        onsetRate: this.onsets.length / 4,
        // Slag det seneste sekund: et trin (omkvæd sætter ind) forbliver et trin, hvor 4-sekunders-tallet
        // glatter det ud til en rampe, der ligner en trommehvirvel.
        onsetRate1: this.onsets.filter((x) => x > t - 1).length,
      };
      const total = snap.bass + snap.mid + snap.treb + EPS;
      snap.shares = [snap.bass / total, snap.mid / total, snap.treb / total];
      this.snaps.push(snap);
      while (this.snaps.length && this.snaps[0].t < t - 30) this.snaps.shift();

      const S = this.stats;
      const tau = 40;
      S.loud = ema(S.loud, snap.loud, 0.25, tau);
      const dev = snap.loud - S.loud;
      S.loudVar = ema(S.loudVar, dev * dev, 0.25, tau);
      S.bass = ema(S.bass, snap.bass, 0.25, tau);
      S.mid = ema(S.mid, snap.mid, 0.25, tau);
      S.treb = ema(S.treb, snap.treb, 0.25, tau);
      S.onset = ema(S.onset, snap.onsetRate, 0.25, tau);
      this.cachedState = null;

      const base = this.window(t - 6, t - 1);
      this.dropBaseline = base.length >= 12 ? median(base.map((s) => s.loud)) : null;
      // Sangens normale niveau: det kraftigste 4-sekunders-niveau indtil nu, der langsomt glemmes. Et
      // gennemsnit ville blive trukket ned af de stille passager, så musikken, der vender tilbage, lignede et drop.
      const last4 = this.window(t - 4, t + 1);
      if (last4.length >= 12) {
        const level = avg(last4, (s) => s.loud);
        const faded = this.songLoudRef === null ? level : this.songLoudRef - this.o.songLoudFadeDbPerSec * 0.25;
        this.songLoudRef = Math.max(faded, level);
      }
      const latest = this.window(t - 1.5, t - 0.2);
      this.buildBaseline = latest.length >= 3 ? Math.max(...latest.map((s) => s.loud)) : null;
      this.buildBassShare = latest.length >= 3 ? avg(latest, (s) => s.shares[0]) : null;
      this.updateBuild(t, events);

      if (t - this.sectionStart < this.o.minSectionSec) return;
      const recent = this.window(t - 4, t + 1);
      const previous = this.window(Math.max(this.sectionStart, t - 16), t - 4);
      if (recent.length < 12 || previous.length < 20) return;

      const sdLoud = Math.max(1.5, Math.sqrt(S.loudVar || 0));
      const novelty = (part) => {
        const dL = (avg(part, (s) => s.loud) - avg(previous, (s) => s.loud)) / sdLoud;
        let dS = 0;
        for (let b = 0; b < 3; b++) dS += Math.abs(avg(part, (s) => s.shares[b]) - avg(previous, (s) => s.shares[b]));
        dS /= 0.08;
        const dO = (avg(part, (s) => s.onsetRate) - avg(previous, (s) => s.onsetRate)) / 0.75;
        return { value: Math.sqrt(dL * dL + (0.7 * dS) ** 2 + (0.5 * dO) ** 2), dL };
      };
      const whole = novelty(recent);
      const half = recent.length >> 1;
      const first = novelty(recent.slice(0, half));
      const second = novelty(recent.slice(half));
      // Forskellen skal holde i hele vinduet, ikke kun være et enkelt kraftigt slag.
      const steady = Math.min(first.value, second.value) > this.o.sectionThreshold * 0.75;
      if (whole.value > this.o.sectionThreshold && steady) {
        this.sectionIndex += 1;
        this.sectionStart = t - 3;
        this.cachedState = null;
        const reason = whole.dL > 0.8 ? 'louder' : whole.dL < -0.8 ? 'quieter' : 'change';
        events.push({ type: 'section', t, index: this.sectionIndex, reason, novelty: whole.value });
        this.tempoFreeUntil = t + this.o.tempoFreeSec;
      }
    }

    /**
     * Opbygning før et drop: lydstyrken stiger jævnt (lineær tilpasning over de seneste buildWindowSec
     * sekunder med høj forklaringsgrad), eller slagene bliver tættere og tættere (trommehvirvel). Et
     * trin, fx fra vers til omkvæd, er ikke en opbygning: der kræves en jævn stigning i hele vinduet.
     */
    updateBuild(t, events) {
      const o = this.o;
      const w = this.window(t - o.buildWindowSec, t + 1);
      const b = this.build;
      if (w.length < o.buildWindowSec * 4 * 0.8) return;
      const n = w.length;
      const mt = avg(w, (s) => s.t);
      const ml = avg(w, (s) => s.loud);
      const mo = avg(w, (s) => s.onsetRate1);
      let stt = 0;
      let stl = 0;
      let sll = 0;
      let sto = 0;
      for (const s of w) {
        const dt = s.t - mt;
        stt += dt * dt;
        stl += dt * (s.loud - ml);
        sll += (s.loud - ml) ** 2;
        sto += dt * (s.onsetRate1 - mo);
      }
      const slope = stl / (stt + EPS); // dB pr. sekund
      const r2 = (stl * stl) / (stt * sll + EPS);
      const onsetSlope = sto / (stt + EPS);
      this.buildStats = { slope, r2, onsetSlope };
      // Et trin (vers → omkvæd) kan også give en pæn hældning over hele vinduet, men stiger kun i den ene
      // halvdel. En opbygning stiger i begge.
      const halfSlope = (part, pick) => {
        const pt = avg(part, (s) => s.t);
        const pv = avg(part, pick);
        let a = 0;
        let c = 0;
        for (const s of part) {
          a += (s.t - pt) * (pick(s) - pv);
          c += (s.t - pt) ** 2;
        }
        return a / (c + EPS);
      };
      const steadyRise = (pick, min) =>
        halfSlope(w.slice(0, n >> 1), pick) >= 0.4 * min && halfSlope(w.slice(n >> 1), pick) >= 0.4 * min;
      const rising = slope >= o.buildMinSlopeDb && r2 >= o.buildMinR2 && steadyRise((s) => s.loud, o.buildMinSlopeDb);
      // Trommehvirvel: slagene bliver tættere i begge halvdele (et omkvæd, der sætter ind med flere slag,
      // er et trin, ikke en hvirvel).
      // Lydstyrken må heller ikke falde i nogen af halvdelene: en rigtig hvirvel før et drop holder eller
      // løfter niveauet (det syntetiske omkvæd gav ellers en falsk opbygning med faldende niveau).
      const rolling =
        onsetSlope >= o.buildMinOnsetSlope &&
        slope > 0.2 &&
        steadyRise((s) => s.onsetRate1, o.buildMinOnsetSlope) &&
        steadyRise((s) => s.loud, 0);
      if (!b.active) {
        if ((rising || rolling) && t - this.lastDrop > 8 && t - this.songStart > 10 && n >= 20) {
          b.active = true;
          b.start = t - o.buildWindowSec / 2;
          b.calmSince = null;
          this.cachedState = null;
          const halves = (pick) => [halfSlope(w.slice(0, n >> 1), pick), halfSlope(w.slice(n >> 1), pick)].map((x) => Math.round(x * 100) / 100);
          events.push({ type: 'buildup', t, slope, onsetSlope, r2, rising, rolling, loudHalves: halves((s) => s.loud), onsetHalves: halves((s) => s.onsetRate1) });
        }
        return;
      }
      const stillRising = slope > 0.3 || onsetSlope > 0.1;
      if (stillRising) b.calmSince = null;
      else if (b.calmSince === null) b.calmSince = t;
      if ((b.calmSince !== null && t - b.calmSince > 1.5) || t - b.start > o.buildMaxSec) this.endBuild(t, events, 'faded');
    }

    endBuild(t, events, reason) {
      if (!this.build.active) return;
      this.build.active = false;
      this.cachedState = null;
      events.push({ type: 'buildupEnd', t, reason });
    }

    /**
     * Den første taktstart på eller efter `time`, forudsagt ud fra tempo og fase. null uden tempo.
     * Instruktøren bruger den til at lægge skift, så de lander på taktstarten.
     */
    downbeatAfter(time) {
      if (!this.tempo.valid || this.nextBeat === null || this.silent) return null;
      const period = 60 / this.tempo.bpm;
      let beat = this.nextBeat;
      let index = this.beatIndex;
      if (time > beat) {
        const skip = Math.ceil((time - beat) / period - 1e-9);
        beat += skip * period;
        index += skip;
      }
      for (let i = 0; i < this.meter && index % this.meter !== this.downbeatPhase; i++) {
        beat += period;
        index += 1;
      }
      return beat;
    }

    /** Tempo, energi og hvilke bånd der fylder mest lige nu, set i forhold til resten af sangen. */
    get state() {
      if (this.cachedState) return this.cachedState;
      const S = this.stats;
      const now = this.lastT === null ? 0 : this.lastT;
      const recent = this.window(now - 4, Infinity);
      let energy = 'mid';
      let dominance = [1 / 3, 1 / 3, 1 / 3];
      if (!this.silent && recent.length >= 8 && S.loud !== null) {
        const z = (avg(recent, (s) => s.loud) - S.loud) / Math.max(1.5, Math.sqrt(S.loudVar || 0));
        energy = z > 0.7 ? 'high' : z < -0.7 ? 'low' : 'mid';
        const rel = [
          avg(recent, (s) => s.bass) / (S.bass + EPS),
          avg(recent, (s) => s.mid) / (S.mid + EPS),
          avg(recent, (s) => s.treb) / (S.treb + EPS),
        ].map((r) => r * r);
        const sum = rel[0] + rel[1] + rel[2];
        if (sum > 0 && Number.isFinite(sum)) dominance = rel.map((r) => r / sum);
      }
      this.cachedState = {
        silent: this.silent,
        tempoValid: this.tempo.valid && !this.silent,
        bpm: this.tempo.valid && !this.silent ? this.tempo.bpm : null,
        confidence: this.tempo.confidence,
        sectionIndex: this.sectionIndex,
        energy,
        dominance,
        building: this.build.active && !this.silent,
        buildStart: this.build.active ? this.build.start : null,
        beatsPerBar: this.meter,
      };
      return this.cachedState;
    }

    /** Konteksten presets vurderes ud fra (se scorePreset). */
    selectionContext() {
      const s = this.state;
      const targetReactivity = s.energy === 'high' ? 0.85 : s.energy === 'low' ? 0.3 : 0.55;
      return { dominance: s.dominance, energy: s.energy, targetReactivity };
    }
  }

  // ---------------------------------------------------------------------------
  // Presets: hvilken del af musikken reagerer de på?
  // ---------------------------------------------------------------------------

  const AUDIO_WORDS = [/\bbass(?:_att)?\b/g, /\bmid(?:_att)?\b/g, /\btreb(?:_att)?\b/g];

  function presetText(preset) {
    const parts = [preset.init_eqs_str, preset.frame_eqs_str, preset.pixel_eqs_str, preset.warp, preset.comp];
    for (const shape of preset.shapes || []) {
      if (shape && shape.baseVals && shape.baseVals.enabled) parts.push(shape.init_eqs_str, shape.frame_eqs_str);
    }
    for (const wave of preset.waves || []) {
      if (wave && wave.baseVals && wave.baseVals.enabled) parts.push(wave.init_eqs_str, wave.frame_eqs_str, wave.point_eqs_str);
    }
    return parts.filter((p) => typeof p === 'string').join('\n');
  }

  /**
   * Tæller hvor tit et preset bruger bass, mid og treb i sine ligninger og shadere.
   * affinity: fordeling over [bas, mellemtone, diskant]; reactivity: 0 = roligt/ambient, 1 = meget lydstyret.
   */
  function profilePreset(preset) {
    const text = presetText(preset || {});
    const counts = AUDIO_WORDS.map((re) => (text.match(re) || []).length);
    const total = counts[0] + counts[1] + counts[2];
    const affinity = counts.map((c) => (c + 1) / (total + 3));
    const base = (preset && preset.baseVals) || {};
    const waveAlpha = base.wave_a === undefined ? 0.8 : base.wave_a;
    const waveVisible = waveAlpha > 0.1 || (preset.waves || []).some((w) => w && w.baseVals && w.baseVals.enabled);
    const reactivity = Math.min(1, Math.log1p(total) / Math.log1p(40) + (waveVisible ? 0.15 : 0));
    return { counts, affinity, reactivity };
  }

  function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / Math.sqrt(na * nb + EPS);
  }

  /** Højere er bedre: passer til de bånd der fylder nu, til energien, plus lidt tilfældighed for variation. */
  function scorePreset(profile, context, random) {
    const r = random === undefined ? Math.random() : random;
    if (!profile || !context) return r;
    const match = cosine(profile.affinity, context.dominance);
    const react = 1 - Math.abs(profile.reactivity - context.targetReactivity);
    return 1.5 * match + 1.0 * react + 0.6 * r;
  }

  // ---------------------------------------------------------------------------
  // Instruktøren: hvornår skal der skiftes preset?
  // ---------------------------------------------------------------------------

  const PRIORITY = { timer: 1, section: 2, track: 3 };
  // Mindste tid siden sidste skift. Et drop må klippe næsten med det samme, også midt i en overgang.
  const MIN_GAP = { timer: 6, section: 8, track: 2, drop: 0.5, accent: 12 };

  class PresetDirector {
    constructor({ random = Math.random } = {}) {
      this.random = random;
      this.lastChange = null;
      this.lastHardCut = -Infinity;
      this.dueAt = null;
      this.pending = null;
      this.lastT = null;
    }

    schedule(t, cfg) {
      // MilkDrop: fast tid mellem skift plus lidt tilfældig variation.
      this.dueAt = t + cfg.cycleSeconds * (0.85 + this.random() * 0.3);
    }

    /** Kaldes ved ethvert skift (også manuelle), så tælleren starter forfra. */
    notifyChange(t, cfg) {
      this.lastChange = t;
      this.pending = null;
      this.schedule(t, cfg);
    }

    request(t, reason, maxWait, synced) {
      if (this.pending && PRIORITY[this.pending.reason] >= PRIORITY[reason]) return;
      this.pending = { reason, deadline: t + maxWait, synced };
    }

    blendFor(state, cfg) {
      if (!(cfg.beatSync && state.tempoValid && state.bpm)) return cfg.blendSeconds;
      const bar = (60 * (state.beatsPerBar || 4)) / state.bpm; // en hel takt
      // Altid hele takter, så overgangen både begynder og slutter på en taktstart (højst 8 s).
      const maxBars = Math.max(1, Math.floor(8 / bar));
      const bars = clamp(Math.round(cfg.blendSeconds / bar), 1, maxBars);
      return bars * bar;
    }

    fire(t, reason, hard, state, cfg, blendSeconds) {
      this.notifyChange(t, cfg);
      if (hard) this.lastHardCut = t;
      const blend = hard ? 0 : blendSeconds !== undefined ? blendSeconds : this.blendFor(state, cfg);
      return { type: 'change', reason, hard, blendSeconds: blend };
    }

    /**
     * Opbygning før et drop: efter 2 takter skift hver takt, fra takt 4 hver halve takt, med korte overgange.
     * Returnerer et skift eller null. Selve droppet giver det hårde klip.
     */
    buildChange(t, events, state, cfg) {
      if (!this.buildSince) {
        this.buildSince = t;
        this.buildChanges = 0;
        this.barBeat = null;
      }
      const period = 60 / state.bpm;
      let change = null;
      for (const e of events) {
        if (e.type !== 'beat') continue;
        if (e.downbeat) this.barBeat = 0;
        else if (this.barBeat !== null) this.barBeat += 1;
        if (this.barBeat === null) continue;
        // Takter siden opbygningen blev opdaget: de første 2 uden ekstra skift (korte crescendoer uden drop
        // må ikke blive hektiske), så hver takt, og fra takt 4 hver halve takt.
        const meter = state.beatsPerBar || 4;
        const bars = (t - this.buildSince) / (meter * period);
        if (bars < 2) continue;
        // Halve takter, når takten kan deles (en takt á 3, 5 eller 7 slag skifter hver takt).
        const every = bars < 4 || meter % 2 ? meter : meter / 2;
        if (this.barBeat % every === 0 && t - this.lastChange >= every * period * 0.8 && this.buildChanges < 24) {
          this.buildChanges += 1;
          change = this.fire(t, 'build', false, state, cfg, Math.min(0.5 * period, cfg.blendSeconds));
        }
      }
      return change;
    }

    /**
     * @param {number} t
     * @param {Array} events hændelser fra MusicEngine.update (samt {type:'track'} fra appen)
     * @param {object} state MusicEngine.state
     * @param {{autoCycle:boolean, cycleSeconds:number, blendSeconds:number, beatSync:boolean,
     *          sectionChanges:boolean, hardCuts:boolean}} cfg
     * @returns {{type:'change', reason:string, hard:boolean, blendSeconds:number}|null}
     */
    update(t, events, state, cfg) {
      const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
      this.lastT = t;
      if (this.lastChange === null) this.lastChange = t;
      if (this.dueAt === null) this.schedule(t, cfg);
      if (!cfg.autoCycle) {
        this.pending = null;
        return null;
      }
      if (state.silent) {
        // Ingen skift mens der er stille; tælleren står stille.
        this.dueAt += dt;
        this.pending = null;
        return null;
      }

      const since = t - this.lastChange;
      const synced = Boolean(cfg.beatSync && state.tempoValid);
      for (const e of events) {
        // Droppet klipper også lige efter et skift i opbygningen; kun et andet hårdt klip spærrer.
        if (e.type === 'drop' && cfg.hardCuts && t - this.lastHardCut >= MIN_GAP.drop) {
          this.buildSince = null;
          return this.fire(t, 'drop', true, state, cfg);
        }
      }
      // Opbygning før et drop: skiftene kommer tættere og tættere på takten.
      if (state.building && synced && cfg.hardCuts && state.bpm) {
        this.pending = null;
        return this.buildChange(t, events, state, cfg);
      }
      this.buildSince = null;
      for (const e of events) {
        if (
          e.type === 'accent' &&
          cfg.hardCuts &&
          state.energy === 'high' &&
          since >= MIN_GAP.accent &&
          t - this.lastHardCut >= 25 &&
          this.random() < 0.35
        ) {
          return this.fire(t, 'accent', true, state, cfg);
        }
        if (e.type === 'track' && since >= MIN_GAP.track) this.request(t, 'track', 1.5, synced);
        if (e.type === 'section' && cfg.sectionChanges && since >= MIN_GAP.section) this.request(t, 'section', 2.5, synced);
      }
      if (!this.pending && t >= this.dueAt && since >= MIN_GAP.timer) this.request(t, 'timer', 4, synced);

      if (this.pending) {
        const p = this.pending;
        const beats = events.filter((e) => e.type === 'beat');
        const onDownbeat = beats.some((e) => e.downbeat);
        if (!p.synced || onDownbeat || (t >= p.deadline && beats.length) || t >= p.deadline + 1.5) {
          return this.fire(t, p.reason, false, state, cfg);
        }
      }
      return null;
    }
  }

  return {
    FeatureExtractor,
    MusicEngine,
    PresetDirector,
    profilePreset,
    scorePreset,
    cosine,
    ENGINE_DEFAULTS,
    BANDS,
  };
});
