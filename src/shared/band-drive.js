/*
 * Bånd-drevet til Tron-laget (src/renderer/tron-overlay.js): forskellige lyde driver forskellige elementer, hver med
 * sin egen timing, så det hele ikke pulserer på kicket.
 *
 *   kick (40-130 Hz) og rigtige kick-onsets fra musikmotoren → gulvets glød og horisonten; attack 20 ms, release 0,22 s
 *   mellem (320 Hz-2,8 kHz: stemme, synth)                   → lyscyklernes spor: lysstyrke, bredde og fart; 0,1/0,25 s
 *   diskant (over 2,8 kHz) og hi-hat-agtige onsets           → glimt i gitterets knuder og skanlinje-flimmer; release 65 ms
 *   dele og opbygninger (musikmotorens tilstand)               → global intensitet og mætning, der stiger gennem et build
 *
 * Hvert bånd normaliseres som i MilkDrop: den aktuelle værdi delt med sit eget løbende gennemsnit (her 15 s), så 1,0 er
 * "som det plejer i denne sang", uanset hvor højt Spotify spiller. Forholdet klemmes (højst 3) og lægges på en skala
 * 0-1 (`lo`-`hi`), før det glattes med båndets attack og release. Gennemsnittet står stille, mens musikmotoren melder
 * stilhed, så en pause ikke får det næste slag til at eksplodere.
 *
 * Release og attack er tidskonstanter: efter `release` sekunder er der 1/e (37 %) tilbage.
 * Ren JavaScript (ingen DOM), testet i test/band-drive.test.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampBandDrive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;
  const FEATURE_KEYS = ['kick', 'mid', 'treb', 'trebFlux']; // fra FeatureExtractor i music-engine.js

  const DEFAULTS = {
    normTauSec: 15, // det løbende gennemsnit, båndene måles mod (MilkDrop bruger ca. 4 s; 10-20 s lader en del af sangen skille sig ud)
    maxRatio: 3,
    // Kick: samme henfald som slag-pulsen før (0,22 s). Med 20 ms attack er højst ca. en tredjedel af blink-vagtens
    // målinger et spring ved 120-200 BPM (målt offline); 0,2 s/12 ms gav op til halvdelen ved 180 BPM, tæt på grænsen.
    kick: { attack: 0.02, release: 0.22, lo: 0.8, hi: 2 },
    // Mellem: ratio 1 (som det plejer) giver 0,5, så lyscyklerne ser ud som før, når mellemtonen er normal.
    mid: { attack: 0.1, release: 0.25, lo: 0.4, hi: 1.6 },
    treb: { attack: 0.01, release: 0.065, lo: 0.8, hi: 2 },
    // Rigtige kicks: musikmotorens kick-onset (kick-fluxen delt med sit 2-sekunders gennemsnit). Hysterese: et nyt
    // kick tæller først, når værdien har været under `off` igen, og tidligst `refractory` sekunder efter det forrige.
    kickOnset: { on: 2.5, off: 1.4, refractory: 0.12 },
    horizonRelease: 0.22,
    // Hi-hats: diskantens flux delt med sit eget gennemsnit (som motorens kick-onset).
    hatOnset: { on: 2.2, off: 1.3, refractory: 0.06, meanTauSec: 2 },
    glintRelease: 0.065,
    realKicksSec: 2, // så længe efter et rigtigt kick følger gulvet kickene i stedet for den forudsagte takt
  };

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /** Forholdet mellem en værdi og dens eget løbende gennemsnit, som MilkDrops bass/mid/treb. */
  class RunningRatio {
    constructor({ tauSec = DEFAULTS.normTauSec, max = DEFAULTS.maxRatio } = {}) {
      this.tau = tauSec;
      this.max = max;
      this.reset();
    }

    reset() {
      this.avg = null;
      this.elapsed = 0;
      this.ratio = 0;
    }

    /**
     * @param {number} value båndets aktuelle værdi (>= 0)
     * @param {number} dt sekunder siden sidst
     * @param {boolean} [frozen] stilhed: gennemsnittet står stille
     * @returns {number} value / gennemsnit, klemt til 0..max
     */
    update(value, dt, frozen = false) {
      if (!frozen) {
        // Indtil der er hørt `tau` sekunder, er det et almindeligt gennemsnit af alt hørt; derefter glidende.
        // Ellers ville den første værdi (måske et stille intro) bestemme forholdet i lang tid.
        this.elapsed += dt;
        const a = this.avg === null ? 1 : Math.max(dt / this.elapsed, 1 - Math.exp(-dt / this.tau));
        this.avg = this.avg === null ? value : this.avg + (value - this.avg) * a;
      }
      if (this.avg === null) this.ratio = 0;
      else this.ratio = clamp(value / Math.max(this.avg, EPS), 0, this.max);
      return this.ratio;
    }
  }

  /** Glatning med egen attack (op) og release (ned), begge som tidskonstanter i sekunder. */
  class Envelope {
    constructor({ attack, release }) {
      this.attack = attack;
      this.release = release;
      this.value = 0;
    }

    update(target, dt) {
      const tau = target > this.value ? this.attack : this.release;
      this.value += (target - this.value) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
      return this.value;
    }

    /** Et slag: værdien springer op (mindst `amount`) og falder derefter med sin release. */
    hit(amount) {
      this.value = Math.max(this.value, amount);
    }
  }

  /** Et onset, når værdien krydser `on` opad, med hysterese (`off`) og mindste afstand (`refractory`). */
  class OnsetGate {
    constructor({ on, off, refractory }) {
      this.on = on;
      this.off = off;
      this.refractory = refractory;
      this.armed = true;
      this.last = -Infinity;
    }

    update(value, t) {
      if (value < this.off) this.armed = true;
      if (this.armed && value >= this.on && t - this.last >= this.refractory) {
        this.armed = false;
        this.last = t;
        return true;
      }
      return false;
    }
  }

  /** Et forhold (1,0 = som det plejer) på skalaen 0-1 mellem lo og hi. */
  function level(ratio, { lo, hi }) {
    return clamp((ratio - lo) / (hi - lo), 0, 1);
  }

  /**
   * Alle bånd samlet. update() kaldes én gang pr. billede med musikmotorens lydtræk og returnerer niveauerne (0-1):
   *   kick     gulvets glød (kick-båndet, glattet)
   *   horizon  horisontens lys fra rigtige kick-onsets
   *   mid      lyscyklernes spor (0,5 = normal mellemtone)
   *   treb     skanlinje-flimmer (diskanten, glattet)
   *   glint    glimt i gitterets knuder fra hi-hat-onsets
   *   kickHit, hatHit  et onset i netop dette billede
   *   realKicks        der er hørt rigtige kicks inden for realKicksSec
   */
  class BandDrive {
    constructor(options = {}) {
      const o = { ...DEFAULTS, ...options };
      this.o = o;
      this.norm = {
        kick: new RunningRatio({ tauSec: o.normTauSec, max: o.maxRatio }),
        mid: new RunningRatio({ tauSec: o.normTauSec, max: o.maxRatio }),
        treb: new RunningRatio({ tauSec: o.normTauSec, max: o.maxRatio }),
      };
      this.env = {
        kick: new Envelope(o.kick),
        mid: new Envelope(o.mid),
        treb: new Envelope(o.treb),
        horizon: new Envelope({ attack: 0, release: o.horizonRelease }),
        glint: new Envelope({ attack: 0, release: o.glintRelease }),
      };
      this.env.mid.value = 0.5;
      this.kickGate = new OnsetGate(o.kickOnset);
      this.hatGate = new OnsetGate(o.hatOnset);
      this.hatMean = null;
      this.lastT = null;
      this.lastKickAt = -Infinity;
      this.out = this.snapshot(false, false, 0);
    }

    /** Ny sang: gennemsnittene starter forfra (en ny sang kan være mastret meget højere eller lavere). */
    reset() {
      for (const n of Object.values(this.norm)) n.reset();
      this.hatMean = null;
    }

    /**
     * @param {number} t tid i sekunder
     * @param {object} f lydtræk fra FeatureExtractor: kick, mid, treb (effekt i båndet) og trebFlux
     * @param {object} [ctx] { silent, kickOnset }: musikmotorens stilhed og kick-onset (MusicEngine.lastKickOnset)
     */
    update(t, f, { silent = false, kickOnset = 0 } = {}) {
      for (const key of FEATURE_KEYS) {
        if (!Number.isFinite(f[key])) throw new TypeError(`BandDrive: feature "${key}" is ${f[key]}`);
      }
      if (!Number.isFinite(kickOnset)) throw new TypeError(`BandDrive: kickOnset is ${kickOnset}`);
      const dt = this.lastT === null ? 1 / 60 : clamp(t - this.lastT, 0, 0.25);
      this.lastT = t;
      const o = this.o;
      // Amplitude (kvadratroden af effekten), som MilkDrop summerer størrelser, ikke effekt: +6 dB giver forholdet 2.
      const rKick = this.norm.kick.update(Math.sqrt(f.kick), dt, silent);
      const rMid = this.norm.mid.update(Math.sqrt(f.mid), dt, silent);
      const rTreb = this.norm.treb.update(Math.sqrt(f.treb), dt, silent);

      const kickHit = !silent && this.kickGate.update(kickOnset, t);
      if (kickHit) {
        this.lastKickAt = t;
        this.env.horizon.hit(clamp(0.4 + 0.15 * kickOnset, 0, 1));
      }
      if (!silent) {
        const a = this.hatMean === null ? 1 : 1 - Math.exp(-dt / o.hatOnset.meanTauSec);
        this.hatMean = this.hatMean === null ? f.trebFlux : this.hatMean + (f.trebFlux - this.hatMean) * a;
      }
      const hatValue = this.hatMean === null ? 0 : Math.min(20, f.trebFlux / (this.hatMean + 1e-4));
      const hatHit = !silent && this.hatGate.update(hatValue, t);
      if (hatHit) this.env.glint.hit(1);

      this.env.kick.update(silent ? 0 : level(rKick, o.kick), dt);
      this.env.mid.update(silent ? 0.5 : level(rMid, o.mid), dt);
      this.env.treb.update(silent ? 0 : level(rTreb, o.treb), dt);
      this.env.horizon.update(0, dt);
      this.env.glint.update(0, dt);
      this.out = this.snapshot(kickHit, hatHit, t);
      return this.out;
    }

    snapshot(kickHit, hatHit, t) {
      return {
        kick: this.env.kick.value,
        horizon: this.env.horizon.value,
        mid: this.env.mid.value,
        treb: this.env.treb.value,
        glint: this.env.glint.value,
        kickHit,
        hatHit,
        realKicks: t - this.lastKickAt < this.o.realKicksSec,
      };
    }
  }

  // Global intensitet og mætning efter sangens del: roligt i stille dele, fuldt i høje, og en opbygning kravler op
  // over det fulde mod droppet. Mætning 1 = temaets egne farver; lavere blander mod hvidt-gråt.
  const SECTION = {
    low: { intensity: 0.75, saturation: 0.65 },
    mid: { intensity: 0.9, saturation: 0.85 },
    high: { intensity: 1, saturation: 1 },
    buildPeak: { intensity: 1.15, saturation: 1 },
    buildRampSec: 12, // så lang tid tager en opbygning om at nå toppen
  };

  /**
   * Målet for global intensitet og mætning ud fra musikmotorens tilstand (energy, building, buildStart, silent).
   * Overlayet glatter mod målet (sekunder, ikke billeder), så skiftet aldrig blinker.
   */
  function sectionTarget(state, t) {
    if (!state || state.silent) return { intensity: SECTION.mid.intensity, saturation: SECTION.mid.saturation };
    const base = SECTION[state.energy] || SECTION.mid;
    if (!state.building || state.buildStart === null || state.buildStart === undefined) {
      return { intensity: base.intensity, saturation: base.saturation };
    }
    const p = clamp((t - state.buildStart) / SECTION.buildRampSec, 0, 1);
    return {
      intensity: base.intensity + (SECTION.buildPeak.intensity - base.intensity) * p,
      saturation: base.saturation + (SECTION.buildPeak.saturation - base.saturation) * p,
    };
  }

  /** En farve [r, g, b] blandet mod sin egen gråtone: mætning 1 = uændret, 0 = grå. */
  function saturate([r, g, b], s) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [Math.round(y + (r - y) * s), Math.round(y + (g - y) * s), Math.round(y + (b - y) * s)];
  }

  return { BandDrive, RunningRatio, Envelope, OnsetGate, level, sectionTarget, saturate, BAND_DRIVE_DEFAULTS: DEFAULTS, SECTION };
});
