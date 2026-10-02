/*
 * Billedtakten for MilkDrop-visualiseringen.
 *
 * Presets bevæger sig pr. tegnet billede: zoom, rotation, henfald og bass_thresh-detektoren i preset-ligningerne er
 * ikke korrigeret for billedraten (Butterchurn tæller kun tiden op med 1/fps). Uden loft løb de 2-2,4 gange så
 * hurtigt på en 120/144 Hz-skærm som ved 60 fps (MilkDrop i Winamp: højst 30 i fuld skærm, MilkDrop3: 60). Derfor
 * tegnes der på hver n-te skærmopdatering, hvor n er det mindste heltal, der giver højst MAX_FPS (76):
 * 60 og 75 Hz: hvert billede, 120 Hz: hvert andet (60), 144 Hz: hvert andet (72),
 * 165 Hz: hvert tredje (55), 240 Hz: hvert fjerde (60). En fast deler giver en jævn takt; en ren tidsgrænse ville
 * skifte mellem 2 og 3 opdateringer på 144 Hz og hakke.
 *
 * Browseren kender ikke skærmens opdateringsrate. Den estimeres ud fra requestAnimationFrame-tidsstemplerne efter det
 * første sekund (indtil da gælder en tidsgrænse) og derefter igen hvert 5. sekund, så et vindue, der flyttes til en
 * anden skærm, får den rigtige deler. Når pc'en ikke kan følge med, kommer rAF sjældnere, estimatet falder, og der
 * tegnes på hvert rAF; billedraten kommer aldrig over loftet.
 *
 * FrameStats samler billedtider til selvtesten (median, 95-percentil, antal over 20 ms).
 * Ren JavaScript (ingen DOM), testet i test/frame-pacer.test.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampFramePacer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_FPS = 76; // højeste billedrate; målet er 60, men 75 Hz-skærme tegnes 1:1 frem for at halveres til 37,5
  const TOLERANCE = 1.04; // tidsstemplerne ryster: 144,5 Hz / 2 skal stadig tælle som 72, men 75 Hz ikke
  const ESTIMATE_MS = 1000; // første estimat efter et sekund
  const REESTIMATE_MS = 5000; // derefter hvert 5. sekund
  const WINDOW = 300; // så mange rAF-intervaller indgår i estimatet
  const GAP_MS = 250; // længere pauser (visualizeren sov, vinduet var skjult) er ikke billedtider
  const SLOW_FRAME_MS = 20; // et billede over 20 ms er et hak ved 60 fps

  /** Deleren n: tegn på hver n-te skærmopdatering, så billedraten højst er maxFps (med lidt tolerance). */
  function divisorFor(refreshHz, maxFps = MAX_FPS) {
    if (!(refreshHz > 0)) return 1;
    let n = 1;
    while (refreshHz / n > maxFps * TOLERANCE) n += 1;
    return n;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  }

  /**
   * Skærmens opdateringsrate (Hz) ud fra rAF-intervaller i ms, eller null med for få målinger. Tabte billeder giver
   * intervaller på 2-3 perioder, så estimatet bygger på den nederste fjerdedel og gennemsnittet af intervallerne
   * tæt på den.
   */
  function estimateRefresh(intervals) {
    const sorted = intervals.filter((d) => d > 0).sort((a, b) => a - b);
    if (sorted.length < 10) return null;
    const base = percentile(sorted, 0.25);
    const near = sorted.filter((d) => Math.abs(d - base) <= base * 0.2);
    return 1000 / (near.reduce((a, b) => a + b, 0) / near.length);
  }

  /** De seneste `capacity` tider (ms) i en ringbuffer. */
  class FrameStats {
    constructor(capacity = 2048) {
      this.values = new Float64Array(capacity);
      this.reset();
    }

    reset() {
      this.count = 0;
    }

    add(ms) {
      this.values[this.count % this.values.length] = ms;
      this.count += 1;
    }

    /** Median, 95-percentil og maksimum (ms, to decimaler) og antal over 20 ms blandt de gemte. */
    summary() {
      const sorted = Array.from(this.values.subarray(0, Math.min(this.count, this.values.length))).sort((a, b) => a - b);
      const r = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
      return {
        count: this.count,
        p50: r(percentile(sorted, 0.5)),
        p95: r(percentile(sorted, 0.95)),
        max: r(sorted[sorted.length - 1]),
        over20: sorted.filter((x) => x > SLOW_FRAME_MS).length,
      };
    }
  }

  class FramePacer {
    constructor({ maxFps = MAX_FPS } = {}) {
      this.maxFps = maxFps;
      this.refreshHz = null; // estimeret opdateringsrate
      this.divisor = 1;
      this.intervals = [];
      this.sinceEstimate = 0;
      this.lastTs = null;
      this.lastRenderTs = null;
      this.phase = 0; // skærmopdateringer siden sidste tegnede billede
      this.rafStats = new FrameStats(); // tid mellem rAF-kald
      this.frameStats = new FrameStats(); // tid mellem tegnede billeder
    }

    /** Billedraten, der tegnes med, når opdateringsraten er kendt. */
    get targetFps() {
      return this.refreshHz ? this.refreshHz / this.divisor : null;
    }

    /** Efter et stop: det næste tidsstempel starter takten forfra, og pausen tæller ikke med. */
    resume() {
      this.lastTs = null;
      this.lastRenderTs = null;
    }

    resetStats() {
      this.rafStats.reset();
      this.frameStats.reset();
    }

    /** Kaldes med hvert requestAnimationFrame-tidsstempel (ms). true: tegn dette billede. */
    tick(ts) {
      const last = this.lastTs;
      if (last !== null && ts <= last) return false; // samme billede to gange
      this.lastTs = ts;
      const dt = last === null ? Infinity : ts - last;
      if (dt > GAP_MS) return this.rendered(ts, false);
      this.rafStats.add(dt);
      this.intervals.push(dt);
      if (this.intervals.length > WINDOW) this.intervals.shift();
      this.sinceEstimate += dt;
      if (this.sinceEstimate >= (this.refreshHz === null ? ESTIMATE_MS : REESTIMATE_MS)) {
        this.sinceEstimate = 0;
        const hz = estimateRefresh(this.intervals);
        if (hz) {
          this.refreshHz = hz;
          this.divisor = divisorFor(hz, this.maxFps);
        }
      }
      if (this.refreshHz === null) {
        // Indtil opdateringsraten kendes: en tidsgrænse lige under 1/maxFps.
        return ts - this.lastRenderTs >= 1000 / (this.maxFps * TOLERANCE) - 1 ? this.rendered(ts, true) : false;
      }
      // Skærmopdateringer siden sidste rAF (et tabt billede tæller med, så takten ikke glider).
      this.phase += Math.max(1, Math.round((dt * this.refreshHz) / 1000));
      return this.phase >= this.divisor ? this.rendered(ts, true) : false;
    }

    rendered(ts, measured) {
      if (measured && this.lastRenderTs !== null) this.frameStats.add(ts - this.lastRenderTs);
      this.lastRenderTs = ts;
      this.phase = 0;
      return true;
    }
  }

  return { FramePacer, FrameStats, divisorFor, estimateRefresh, MAX_FPS };
});
