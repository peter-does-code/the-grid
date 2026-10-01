/*
 * Den lille analysator i afspillerens display, som i Winamps hovedvindue:
 * 76 x 16 pixels, 19 bjælker med faldende toppunkter, eller et oscilloskop. Klik skifter tilstand.
 */
(function () {
  'use strict';

  const WIDTH = 76;
  const HEIGHT = 16;
  const BARS = 19;
  const BAR_WIDTH = 3;
  const BAR_STEP = 4;
  const MODES = ['spectrum', 'scope', 'off'];

  // Farveskala pr. tema; farven følger pixelrækken (0 = top).
  // classic: egen skala i Winamp-ånd (rød, gul, grøn). grid: lysvæg-cyan. clu: Clus orange.
  const PALETTES = {
    classic: {
      stops: [
        [0, [255, 60, 30]],
        [0.3, [255, 150, 30]],
        [0.5, [255, 224, 40]],
        [0.72, [150, 240, 40]],
        [1, [30, 216, 40]],
      ],
      peak: '#b9b9cc',
      dot: '#15151d',
    },
    grid: {
      stops: [
        [0, [240, 255, 255]],
        [0.3, [140, 246, 255]],
        [0.6, [0, 229, 255]],
        [1, [0, 96, 150]],
      ],
      peak: '#ff8a1e',
      dot: '#06161c',
    },
    clu: {
      stops: [
        [0, [255, 244, 225]],
        [0.3, [255, 190, 110]],
        [0.6, [255, 138, 30]],
        [1, [150, 60, 0]],
      ],
      peak: '#00e5ff',
      dot: '#1c1006',
    },
  };

  function colorAt(stops, t) {
    for (let i = 1; i < stops.length; i++) {
      const [t1, c1] = stops[i];
      const [t0, c0] = stops[i - 1];
      if (t <= t1) {
        const k = (t - t0) / (t1 - t0);
        const mix = (j) => Math.round(c0[j] + (c1[j] - c0[j]) * k);
        return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
      }
    }
    const last = stops[stops.length - 1][1];
    return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
  }

  /** Logaritmisk fordelte frekvensbånd fra 50 Hz til 16 kHz, som bins i FFT'en. */
  function buildBands(sampleRate, fftSize) {
    const binHz = sampleRate / fftSize;
    const maxBin = fftSize / 2 - 1;
    const low = 50;
    const high = Math.min(16000, sampleRate / 2);
    const bands = [];
    for (let i = 0; i < BARS; i++) {
      const f0 = low * Math.pow(high / low, i / BARS);
      const f1 = low * Math.pow(high / low, (i + 1) / BARS);
      const b0 = Math.min(maxBin, Math.max(1, Math.floor(f0 / binHz)));
      const b1 = Math.min(maxBin, Math.max(b0 + 1, Math.ceil(f1 / binHz)));
      bands.push([b0, b1]);
    }
    return bands;
  }

  class MiniSpectrum {
    constructor(canvas, { mode = 'spectrum', theme = 'grid' } = {}) {
      this.canvas = canvas;
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.mode = MODES.includes(mode) ? mode : 'spectrum';
      this.analyser = null;
      this.source = null;
      this.heights = new Float32Array(BARS);
      this.peaks = new Float32Array(BARS);
      this.hold = new Uint8Array(BARS);
      this.rms = 0;
      this.setPalette(theme);
    }

    /** Skifter farver efter temaet ('grid', 'clu' eller 'classic'). */
    setPalette(theme) {
      const palette = PALETTES[theme] || PALETTES.grid;
      this.rowColors = Array.from({ length: HEIGHT }, (_, row) => colorAt(palette.stops, row / (HEIGHT - 1)));
      this.peakColor = palette.peak;
      this.dotColor = palette.dot;
      this.background = this.buildBackground();
    }

    buildBackground() {
      const bg = document.createElement('canvas');
      bg.width = WIDTH;
      bg.height = HEIGHT;
      const ctx = bg.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = this.dotColor;
      for (let y = 1; y < HEIGHT; y += 2) {
        for (let x = 1; x < WIDTH; x += 2) ctx.fillRect(x, y, 1, 1);
      }
      return bg;
    }

    connect(audioContext, source) {
      this.disconnect();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -88;
      analyser.maxDecibels = -22;
      source.connect(analyser);
      this.analyser = analyser;
      this.source = source;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.time = new Uint8Array(analyser.fftSize);
      this.bands = buildBands(audioContext.sampleRate, analyser.fftSize);
    }

    disconnect() {
      if (this.source && this.analyser) {
        try {
          this.source.disconnect(this.analyser);
        } catch {
          // Allerede frakoblet.
        }
      }
      this.analyser = null;
      this.source = null;
    }

    /** RMS-niveau 0..1 af den seneste lydblok; bruges til LYD-lampen og selvtesten. */
    level() {
      return this.rms;
    }

    setMode(mode) {
      if (MODES.includes(mode)) this.mode = mode;
    }

    cycleMode() {
      this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
      return this.mode;
    }

    start() {
      const loop = () => {
        this.frame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    frame() {
      const analyser = this.analyser;
      if (analyser) {
        analyser.getByteTimeDomainData(this.time);
        analyser.getByteFrequencyData(this.freq);
        let sum = 0;
        for (let i = 0; i < this.time.length; i++) {
          const v = (this.time[i] - 128) / 128;
          sum += v * v;
        }
        this.rms = Math.sqrt(sum / this.time.length);
      } else {
        this.rms = 0;
      }

      const ctx = this.ctx;
      ctx.drawImage(this.background, 0, 0);
      if (this.muted) {
        // Ingen musik: bjælkerne falder ud, og der tegnes ikke mere.
        this.heights.fill(0);
        this.peaks.fill(0);
        return;
      }
      if (this.mode === 'spectrum') this.drawSpectrum(ctx);
      else if (this.mode === 'scope') this.drawScope(ctx);
    }

    /** Uden musik viser analysatoren intet, ligesom visualizeren. */
    setMuted(muted) {
      this.muted = Boolean(muted);
    }

    drawSpectrum(ctx) {
      for (let i = 0; i < BARS; i++) {
        let target = 0;
        if (this.analyser) {
          const [b0, b1] = this.bands[i];
          let max = 0;
          for (let b = b0; b < b1; b++) if (this.freq[b] > max) max = this.freq[b];
          target = Math.pow(max / 255, 1.25) * HEIGHT;
        }
        // Bjælker falder langsomt, toppunkter holder et øjeblik og falder så — Winamps kendte bevægelse.
        this.heights[i] = Math.max(target, this.heights[i] - 0.8);
        if (this.heights[i] >= this.peaks[i]) {
          this.peaks[i] = this.heights[i];
          this.hold[i] = 18;
        } else if (this.hold[i] > 0) {
          this.hold[i] -= 1;
        } else {
          this.peaks[i] = Math.max(0, this.peaks[i] - 0.3);
        }

        const x = i * BAR_STEP;
        const h = Math.round(this.heights[i]);
        for (let row = HEIGHT - h; row < HEIGHT; row++) {
          ctx.fillStyle = this.rowColors[row];
          ctx.fillRect(x, row, BAR_WIDTH, 1);
        }
        if (this.peaks[i] >= 1) {
          ctx.fillStyle = this.peakColor;
          ctx.fillRect(x, Math.max(0, HEIGHT - 1 - Math.floor(this.peaks[i])), BAR_WIDTH, 1);
        }
      }
    }

    drawScope(ctx) {
      if (!this.analyser) return;
      const step = Math.floor(Math.min(this.time.length, 608) / WIDTH);
      let prev = null;
      for (let x = 0; x < WIDTH; x++) {
        const v = (this.time[x * step] - 128) / 128;
        const y = Math.max(0, Math.min(HEIGHT - 1, Math.round(((1 - v) * (HEIGHT - 1)) / 2)));
        const from = prev === null ? y : Math.min(prev, y);
        const to = prev === null ? y : Math.max(prev, y);
        for (let row = from; row <= to; row++) {
          const distance = Math.abs(row - (HEIGHT - 1) / 2) / ((HEIGHT - 1) / 2);
          ctx.fillStyle = this.rowColors[Math.round((1 - distance) * (HEIGHT - 1))];
          ctx.fillRect(x, row, 1, 1);
        }
        prev = y;
      }
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.MiniSpectrum = MiniSpectrum;
})();
