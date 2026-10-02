/*
 * Automatisk lydniveau foran Butterchurn: en langsom trim pr. nummer, ikke en kompressor.
 *
 * Butterchurns bass/mid/treb er forhold mod et løbende gennemsnit over ca. 4 s (longAvg, τ ≈ 4,15 s). En
 * forstærkning, der følger niveauet på samme tidsskala, fjerner netop det, presets reagerer på: et omkvæd
 * 10 dB højere end verset så roligere ud end gennemsnittet efter 3 s (research 02-10-2026,
 * .claude/plans/2026-10-02-visualizer-research.md, fund 1 og 3). Derfor:
 *   - niveaufølgeren er langsom og symmetrisk (τ 25 s), og forstærkningen glider mod målet med τ 8 s. Høje og
 *     stille passager i et nummer bliver ved med at være høje og stille; kun forskellen mellem numre og
 *     Spotifys lydstyrkeskyder udlignes;
 *   - målet er lavt (RMS 0,09, ca. -21 dBFS), så toppene har plads, og begrænseren efter forstærkningen kun er
 *     et sikkerhedsnet;
 *   - kun overstyring rettes hurtigt: ville signalet efter forstærkning komme over RMS 0,5, tages forstærkningen
 *     ned med det samme til RMS 0,45 (fx et stille intro, der har skruet op, før bandet kommer ind). Niveauet
 *     løftes samtidig, så den langsomme trim fortsætter nedad derfra i stedet for at skrue op igen;
 *   - reseed(): de næste 0,2 s med lyd måles, og forstærkningen sættes direkte ud fra dem (ingen glidning).
 *     Bruges ved nummerskift, når musikken kommer tilbage efter mindst 3 s stilhed, og når Init stopper.
 *     En ny trim starter også sådan;
 *   - i stilhed (musikmotorens `silent`, og under RMS 0,0015) står alt stille, så svag baggrundslyd ikke pustes
 *     op, og en reseed venter på lyd.
 * Lidt forstærkning er stadig nødvendig til stille kilder: Butterchurn læser 8-bit-samples, og ét trin er ca.
 * -42 dBFS. Derfor 0,5-12 gange.
 * Ren JavaScript (ingen DOM), testet i test/agc.test.js. Bruges af src/renderer/music.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampAgc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    targetRms: 0.09,
    minGain: 0.5,
    maxGain: 12,
    levelTauSec: 25, // niveaufølgeren; skal være meget langsommere end Butterchurns 4 s
    gainTauSec: 8, // forstærkningen glider mod målet
    overloadRms: 0.5, // over dette efter forstærkning: forstærkningen ned med det samme ...
    overloadToRms: 0.45, // ... til dette
    silenceRms: 0.0015,
    seedSec: 0.2, // så meget lyd måles efter reseed()
  };

  class Agc {
    constructor(options = {}) {
      this.o = { ...DEFAULTS, ...options };
      this.gain = 1;
      this.level = null; // langsomt niveau (RMS før forstærkning)
      this.lastT = null;
      this.seed = null;
      this.reseed(); // den første lyd sætter niveauet
    }

    /** Glemmer niveauet: de næste `seedSec` sekunder med lyd måles, og forstærkningen sættes direkte. */
    reseed() {
      this.seed = { sum: 0, sec: 0 };
    }

    /** true, mens en reseed venter på eller måler lyd. */
    get seeding() {
      return this.seed !== null;
    }

    clampGain(gain) {
      return Math.min(this.o.maxGain, Math.max(this.o.minGain, gain));
    }

    /**
     * Et billede: `rms` er det rå signals RMS (før forstærkning) til tiden `t` (sekunder).
     * @returns {number} forstærkningen, der skal bruges fra nu af.
     */
    update(t, rms, { silent = false } = {}) {
      const o = this.o;
      const dt = this.lastT === null ? 1 / 60 : Math.min(0.25, Math.max(0.001, t - this.lastT));
      this.lastT = t;
      if (silent || rms < o.silenceRms) return this.gain;

      if (this.seed) {
        this.seed.sum += rms * dt;
        this.seed.sec += dt;
        if (this.seed.sec >= o.seedSec - 1e-9) {
          this.level = this.seed.sum / this.seed.sec;
          this.gain = this.clampGain(o.targetRms / this.level);
          this.seed = null;
        }
        // Under målingen holdes forstærkningen; kun overstyring rettes.
        this.protect(rms);
        return this.gain;
      }

      this.level += (rms - this.level) * (1 - Math.exp(-dt / o.levelTauSec));
      const wanted = this.clampGain(o.targetRms / this.level);
      this.gain += (wanted - this.gain) * (1 - Math.exp(-dt / o.gainTauSec));
      this.protect(rms);
      return this.gain;
    }

    /** Hurtig nedregulering, hvis signalet efter forstærkning ville overstyre. */
    protect(rms) {
      const o = this.o;
      if (rms * this.gain <= o.overloadRms) return;
      this.gain = Math.max(o.minGain, Math.min(this.gain, o.overloadToRms / rms));
      // Niveauet løftes, så målet ikke ligger over den nye forstærkning, og trimmen ikke skruer op igen.
      if (this.level !== null) this.level = Math.max(this.level, o.targetRms / this.gain);
    }
  }

  return { Agc, AGC_DEFAULTS: DEFAULTS };
});
