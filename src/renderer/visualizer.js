/*
 * MilkDrop-visualizeren: Butterchurn (MIT) er en WebGL-genimplementering af MilkDrop 2,
 * Winamps klassiske visualizer, og afspiller de originale preset-filer.
 */
(function () {
  'use strict';

  const PRESET_PACKS = [
    'butterchurnPresets',
    'butterchurnPresetsExtra',
    'butterchurnPresetsExtra2',
    'butterchurnPresetsMD1',
    'butterchurnPresetsMinimal',
    'butterchurnPresetsNonMinimal',
    // De bedste fra Cream of the Crop, udvalgt af preset-testen (scripts/build-preset-pack.js).
    'gridPresetsCreamOfTheCrop',
  ];
  const MAX_RENDER_WIDTH = 2560; // over dette bliver GPU-belastningen høj uden synlig gevinst
  // De sidst viste presets kommer ikke igen foreløbig. Med over 1.000 presets kan vinduet være stort; med 25
  // kom de samme ca. 60 favoritter igen og igen, når valget styres af målingerne (simuleret 01-10-2026).
  const RECENT_EXCLUDE = 150;
  const PICK_TOP = 12; // valget trækkes blandt de bedste ...
  const PICK_TEMPERATURE = 0.25; // ... vægtet efter score (lavere = mere grådigt)

  function unwrap(mod) {
    return mod && mod.default ? mod.default : mod;
  }

  function collectPresets() {
    const all = {};
    for (const name of PRESET_PACKS) {
      const pack = unwrap(window[name]);
      if (!pack || typeof pack.getPresets !== 'function') {
        console.warn('Preset pack missing:', name);
        continue;
      }
      Object.assign(all, pack.getPresets());
    }
    // Presets, Peter har fjernet (scripts/preset-bans.txt, lagt i preset-pakken af build-preset-pack.js).
    const ours = unwrap(window.gridPresetsCreamOfTheCrop);
    const key = (n) => String(n).trim().toLowerCase().split(/\s+/).join(' '); // mellemrum tæller ikke
    const bans = new Set(((ours && ours.bans) || []).map(key));
    for (const name of Object.keys(all)) if (bans.has(key(name))) delete all[name];
    return all;
  }

  class Visualizer {
    constructor(canvas, { audioContext, onPresetChange } = {}) {
      const butterchurn = unwrap(window.butterchurn);
      if (!butterchurn || typeof butterchurn.createVisualizer !== 'function') {
        throw new Error('Butterchurn could not be loaded.');
      }
      this.canvas = canvas;
      this.onPresetChange = onPresetChange;
      this.audioContext = audioContext || new AudioContext({ latencyHint: 'interactive' });
      this.presets = collectPresets();
      this.names = Object.keys(this.presets).sort((a, b) => a.localeCompare(b, 'en'));
      this.failed = new Set();
      this.history = [];
      this.historyIndex = -1;
      this.current = null;
      this.frames = 0;
      this.running = false;

      const { width, height } = this.measure();
      canvas.width = width;
      canvas.height = height;
      this.viz = butterchurn.createVisualizer(this.audioContext, canvas, { width, height, pixelRatio: 1, textureRatio: 1 });
      this.isWebGL2 = Boolean(canvas.getContext('webgl2'));

      this.installTransitions();

      const extraImages = unwrap(window.butterchurnExtraImages);
      if (extraImages && typeof extraImages.getImages === 'function') {
        this.viz.loadExtraImages(extraImages.getImages());
      }

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }

    measure() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let width = Math.max(2, Math.round(rect.width * dpr));
      let height = Math.max(2, Math.round(rect.height * dpr));
      if (width > MAX_RENDER_WIDTH) {
        height = Math.round((height * MAX_RENDER_WIDTH) / width);
        width = MAX_RENDER_WIDTH;
      }
      return { width, height };
    }

    resize() {
      const { width, height } = this.measure();
      if (width === this.canvas.width && height === this.canvas.height) return;
      this.canvas.width = width;
      this.canvas.height = height;
      this.viz.setRendererSize(width, height);
    }

    connect(audioNode) {
      this.viz.connectAudio(audioNode);
    }

    disconnect(audioNode) {
      try {
        this.viz.disconnectAudio(audioNode);
      } catch {
        // Allerede frakoblet.
      }
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        try {
          this.viz.render();
          this.frames += 1;
        } catch (err) {
          console.error('Render error:', err);
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }

    /**
     * Overgangene mellem presets, uden at ændre Butterchurns filer:
     * - Mønsteret (Butterchurns "mixType"): 1 = en kant, der fejer hen over billedet, 2 = plasma (en organisk
     *   opløsning), 3 = en cirkel, der åbner sig fra midten. Butterchurn trækker det tilfældigt; her vælger appen.
     * - Forløbet: Butterchurn går jævnt fra 0 til 1. Med `beats` går overgangen i ryk på slagene i stedet:
     *   hvert slag skubber den et stykke frem (hurtigt i starten af slaget), og imellem står den stille.
     */
    installTransitions() {
      const renderer = this.viz && this.viz.renderer;
      if (!renderer || !renderer.blendPattern) return;
      const self = this;
      const pattern = renderer.blendPattern;
      const create = pattern.createBlendPattern.bind(pattern);
      pattern.createBlendPattern = () => {
        const want = self.activeTransition && self.activeTransition.pattern;
        if (!want) return create();
        // Butterchurns første Math.random() i createBlendPattern vælger mønsteret (1 + floor(r * 3)).
        const random = Math.random;
        let first = true;
        Math.random = () => {
          if (!first) return random();
          first = false;
          return (want - 1) / 3 + 0.01;
        };
        try {
          return create();
        } finally {
          Math.random = random;
        }
      };
      let raw = renderer.blendProgress || 0;
      Object.defineProperty(renderer, 'blendProgress', {
        configurable: true,
        get() {
          return self.shapeBlend(raw);
        },
        set(value) {
          raw = value;
        },
      });
      this.transitionsInstalled = true; // selvtesten tjekker, at krogene sidder i den rigtige Butterchurn
    }

    /** Overgangens forløb (0-1) fra Butterchurns jævne forløb. Over 1 er overgangen slut og røres ikke. */
    shapeBlend(p) {
      const beats = this.activeTransition && this.activeTransition.beats;
      if (!beats || p <= 0 || p >= 1) return p;
      const k = p * beats;
      const i = Math.floor(k);
      const f = (k - i) / 0.35; // de første 35 % af hvert slag
      const step = f >= 1 ? 1 : 1 - Math.pow(1 - f, 3);
      return Math.min(1, (i + step) / beats);
    }

    /** Næste overgang: { beats, pattern } (se installTransitions). Gælder kun det næste skift. */
    setNextTransition(transition) {
      this.nextTransition = transition || null;
    }

    load(name, blendSeconds = 0, { pushHistory = true } = {}) {
      const preset = this.presets[name];
      if (!preset || this.failed.has(name)) return false;
      this.activeTransition = blendSeconds > 0 ? this.nextTransition : null;
      this.nextTransition = null;
      try {
        this.viz.loadPreset(preset, blendSeconds);
      } catch (err) {
        console.warn('Preset could not be loaded:', name, err);
        this.failed.add(name);
        return false;
      }
      this.current = name;
      if (pushHistory) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(name);
        if (this.history.length > 300) this.history.shift();
        this.historyIndex = this.history.length - 1;
      }
      if (this.onPresetChange) this.onPresetChange(name);
      return true;
    }

    randomName() {
      const recent = new Set(this.history.slice(-RECENT_EXCLUDE));
      let pool = this.names.filter((n) => !recent.has(n) && !this.failed.has(n));
      if (pool.length === 0) pool = this.names.filter((n) => n !== this.current && !this.failed.has(n));
      return pool[Math.floor(Math.random() * pool.length)];
    }

    sequentialName(step) {
      const index = this.current ? this.names.indexOf(this.current) : -1;
      const count = this.names.length;
      return this.names[(((index + step) % count) + count) % count];
    }

    /**
     * Næste preset. Er man gået tilbage i historikken, går "næste" først frem igen, som i MilkDrop.
     * `pick` kan vælge et preset ud fra musikken (se pickSmart); ellers tilfældigt eller i rækkefølge.
     */
    next({ random = true, blendSeconds = 2.7, pick = null } = {}) {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex += 1;
        if (this.load(this.history[this.historyIndex], blendSeconds, { pushHistory: false })) return true;
      }
      if (random && pick) {
        const name = pick();
        if (name && this.load(name, blendSeconds)) return true;
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const name = random ? this.randomName() : this.sequentialName(1 + attempt);
        if (name && this.load(name, blendSeconds)) return true;
      }
      return false;
    }

    /** Hvilke dele af musikken presettet reagerer på (beregnes første gang, der spørges). */
    profile(name) {
      if (!this.profiles) this.profiles = new Map();
      if (!this.profiles.has(name)) {
        const preset = this.presets[name];
        const profile = preset && window.VisampMusic ? window.VisampMusic.profilePreset(preset) : null;
        // Målingerne fra preset-testen (src/renderer/presets/preset-stats.js), hvis presettet er målt.
        const stats = window.gridPresetStats && window.gridPresetStats[name];
        if (profile && stats) profile.stats = stats;
        this.profiles.set(name, profile);
      }
      return this.profiles.get(name);
    }

    /**
     * Et preset blandt de ikke nyligt viste efter `score(profile)`: trukket blandt de PICK_TOP bedste, vægtet
     * efter score, så valget følger musikken uden at de samme få presets vinder hver gang.
     */
    pickSmart(score, random = Math.random) {
      const recent = new Set(this.history.slice(-Math.min(RECENT_EXCLUDE, Math.floor(this.names.length / 2))));
      let pool = this.names.filter((n) => !recent.has(n) && !this.failed.has(n));
      if (pool.length === 0) pool = this.names.filter((n) => n !== this.current && !this.failed.has(n));
      const top = pool
        .map((name) => [name, score(this.profile(name))])
        .sort((a, b) => b[1] - a[1])
        .slice(0, PICK_TOP);
      if (!top.length) return null;
      const weights = top.map(([, s]) => Math.exp((s - top[0][1]) / PICK_TEMPERATURE));
      let r = random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < top.length; i++) {
        r -= weights[i];
        if (r <= 0) return top[i][0];
      }
      return top[top.length - 1][0];
    }

    /** Uden musik: fad til sort og stop renderingen, så GPU'en hviler. */
    setAsleep(asleep) {
      if (asleep === Boolean(this.asleep)) return;
      this.asleep = asleep;
      this.canvas.classList.toggle('asleep', asleep);
      clearTimeout(this.sleepTimer);
      if (asleep) {
        this.sleepTimer = setTimeout(() => {
          if (this.asleep) this.stop();
        }, 700);
      } else {
        this.start();
      }
    }

    previous({ blendSeconds = 2.7 } = {}) {
      if (this.historyIndex > 0) {
        this.historyIndex -= 1;
        return this.load(this.history[this.historyIndex], blendSeconds, { pushHistory: false });
      }
      return this.load(this.sequentialName(-1), blendSeconds);
    }

    /** MilkDrops titelanimation, når et nyt nummer begynder. */
    showTitle(text) {
      if (!text) return;
      try {
        this.viz.launchSongTitleAnim(text);
      } catch (err) {
        console.warn('Titelanimation fejlede:', err);
      }
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.Visualizer = Visualizer;
})();
