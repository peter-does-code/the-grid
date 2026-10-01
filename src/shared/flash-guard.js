/*
 * Blink-vagten: holder øje med billedets lysstyrke, mens et preset vises, og melder, hvis det blinker konstant
 * (stroboskop). Nogle presets er fine i rolige dele, men blinker hele tiden i hurtige. Så skiftes der videre.
 *
 * Den må ikke overreagere. Presets, der blinker med musikken, skal blive (Peters eksempler: "yin - 315 - Ocean of
 * Light" og "martin - cope - laser dome"). Et blink pr. slag ved 120-180 BPM giver højst ca. 0,2 spring pr. måling
 * (tænd og sluk), mens de konstant blinkende presets fra preset-testen lå på 0,5-0,9. Derfor skal alt dette gælde:
 *   - mindst \`threshold\` (55 %) af målingerne de seneste \`windowSec\` (4 s) er et spring i lysstyrke på over
 *     \`jump\` (0,06);
 *   - to vinduer i træk (8 s konstant blink);
 *   - mindst \`settleSec\` (6 s) efter et skift, så overgangen ikke tæller med;
 *   - mindst \`cooldownSec\` (30 s) mellem to skift fra vagten.
 * Ren JavaScript (ingen DOM), testet i test/flash-guard.test.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampFlashGuard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = { windowSec: 4, threshold: 0.55, jump: 0.06, windows: 2, settleSec: 6, cooldownSec: 30 };

  class FlashGuard {
    constructor(options = {}) {
      this.o = { ...DEFAULTS, ...options };
      this.samples = []; // [t, lysstyrke]
      this.strikes = 0;
      this.windowStart = null;
      this.changedAt = -Infinity;
      this.lastTrip = -Infinity;
    }

    /** Et nyt preset vises: målingen starter forfra, og overgangen tæller ikke. */
    notifyChange(t) {
      this.changedAt = t;
      this.samples = [];
      this.strikes = 0;
      this.windowStart = null;
    }

    /**
     * En måling af billedets gennemsnitlige lysstyrke (0-1) til tiden t (sekunder).
     * @returns {boolean} true, når presettet har blinket konstant længe nok, og der bør skiftes.
     */
    feed(t, luma) {
      const o = this.o;
      if (t - this.changedAt < o.settleSec) return false;
      this.samples.push([t, luma]);
      if (this.windowStart === null) this.windowStart = t;
      if (t - this.windowStart < o.windowSec) return false;
      // Et helt vindue: hvor stor en andel af målingerne er et spring?
      let jumps = 0;
      for (let i = 1; i < this.samples.length; i++) if (Math.abs(this.samples[i][1] - this.samples[i - 1][1]) > o.jump) jumps += 1;
      const share = jumps / Math.max(1, this.samples.length - 1);
      this.samples = [this.samples[this.samples.length - 1]];
      this.windowStart = t;
      this.strikes = share >= o.threshold ? this.strikes + 1 : 0;
      if (this.strikes >= o.windows && t - this.lastTrip >= o.cooldownSec) {
        this.lastTrip = t;
        this.strikes = 0;
        return true;
      }
      return false;
    }
  }

  return { FlashGuard, FLASH_GUARD_DEFAULTS: DEFAULTS };
});
