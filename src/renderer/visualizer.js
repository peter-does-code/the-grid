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
    // MilkDrops egen pakke fra Winamp (Winamp-klassikerne, samme script).
    'gridPresetsWinampClassics',
  ];
  const MAX_RENDER_WIDTH = 2560; // over dette bliver GPU-belastningen høj uden synlig gevinst
  // De sidst viste presets kommer ikke igen foreløbig. Med over 1.000 presets kan vinduet være stort; med 25
  // kom de samme ca. 60 favoritter igen og igen, når valget styres af målingerne (simuleret 01-10-2026).
  const RECENT_EXCLUDE = 150;
  const PICK_TOP = 20; // valget trækkes blandt de bedste ...
  const PICK_TEMPERATURE = 0.35; // ... vægtet efter score (lavere = mere grådigt)
  // Så stor en andel af de musikstyrede skift er helt tilfældige, så hele samlingen bliver set (Peter 02-10-2026).
  const RANDOM_SHARE = 0.2;
  // Brugerens favoritter (K) vægtes først, når der er FAVORITE_FULL_AT af dem (Peter 02-10-2026): før det er de
  // helt almindelige presets. Derefter et tillæg i valget, og de må komme igen efter 40 skift i stedet for 150.
  const FAVORITE_BONUS = 0.8;
  const FAVORITE_EXCLUDE = 40;
  // Ved tilfældig rækkefølge: så stor en andel af skiftene går til en favorit (når de vægtes).
  const FAVORITE_SHARE = 0.2;
  const FAVORITE_FULL_AT = 20;
  // Loft: højst FAVORITE_CAP favoritter blandt de seneste FAVORITE_WINDOW skift, ellers venter de alle.
  const FAVORITE_CAP = 4;
  const FAVORITE_WINDOW = 20;

  function unwrap(mod) {
    return mod && mod.default ? mod.default : mod;
  }

  function collectPresets() {
    // Review-tilstand (--review): kun presets til gennemsyn.
    if (window.gridReviewPresets) return { ...window.gridReviewPresets };
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
      this.allNames = this.names.slice(); // også de skjulte (derezzede), til preset-listen
      // Jurassic Grid (kommandoen "dino"): dinosaur-presets er en egen liste uden for udvalget. I dino-tilstand kommer
      // cirka hvert tiende automatiske skift fra den. De kan altid indlæses (historik, preset-listen).
      const dino = unwrap(window.gridPresetsDino);
      this.dinoNames = dino && typeof dino.getPresets === 'function' && !window.gridReviewPresets ? Object.keys(dino.getPresets()) : [];
      if (this.dinoNames.length) Object.assign(this.presets, dino.getPresets());
      this.dinoMode = false;
      this.dinoCountdown = 0;
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
      this.installReactivity();
      this.maxFps = 30;

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

    /**
     * Højst så mange billeder i sekundet (0 = skærmens egen takt). MilkDrop-presets flytter billedet et fast stykke
     * pr. billede, så på en 120-144 Hz-skærm kørte alt 2-2,5 gange hurtigere end i Winamp (Peter 05-10-2026: "for
     * kaotisk/for hurtigt" til en fest). 30 er det gamle Winamp-udtryk.
     */
    setMaxFps(fps) {
      this.maxFps = fps > 0 ? fps : 0;
      this.nextFrameAt = 0;
    }

    /**
     * Hvor meget presets reagerer på lyden (0-1). Butterchurn giver dem bass, mid og treb som forholdet til et
     * langt gennemsnit (1 = normalt), som MilkDrop. Her dæmpes udsvinget omkring 1: 0,5 giver halvt så store
     * hop, 1 er som i MilkDrop.
     */
    setReactivity(amount) {
      this.reactivity = Math.max(0, Math.min(1, Number(amount)));
    }

    installReactivity() {
      const levels = this.viz && this.viz.renderer && this.viz.renderer.audioLevels;
      if (!levels || !levels.val || !levels.att) return;
      this.reactivity = 1;
      const self = this;
      const damp = (x) => 1 + (x - 1) * self.reactivity;
      ['bass', 'mid', 'treb'].forEach((band, i) => {
        Object.defineProperty(levels, band, { configurable: true, get: () => damp(levels.val[i]) });
        Object.defineProperty(levels, `${band}_att`, { configurable: true, get: () => damp(levels.att[i]) });
      });
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.nextFrameAt = 0;
      const loop = (now) => {
        if (!this.running) return;
        this.raf = requestAnimationFrame(loop);
        if (this.maxFps > 0) {
          const interval = 1000 / this.maxFps;
          // 1 ms tolerance: requestAnimationFrame kommer ikke helt præcist.
          if (now < this.nextFrameAt - 1) return;
          this.nextFrameAt += interval;
          if (this.nextFrameAt < now) this.nextFrameAt = now + interval; // første billede, eller langt bagud
        }
        try {
          this.viz.render();
          this.frames += 1;
          // Billedets lysstyrke til blink-vagten (src/shared/flash-guard.js), hvert andet billede.
          if (this.onLuma && this.frames % 2 === 0) this.onLuma(this.measureLuma());
        } catch (err) {
          console.error('Render error:', err);
        }
      };
      this.raf = requestAnimationFrame(loop);
    }

    /** Gennemsnitlig lysstyrke (0-1) af det netop tegnede billede, målt på et lille udsnit (8x6). */
    measureLuma() {
      if (!this.lumaCanvas) {
        this.lumaCanvas = document.createElement('canvas');
        this.lumaCanvas.width = 8;
        this.lumaCanvas.height = 6;
        this.lumaCtx = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
      }
      this.lumaCtx.drawImage(this.canvas, 0, 0, 8, 6);
      const d = this.lumaCtx.getImageData(0, 0, 8, 6).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (48 * 255);
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

    /** Tager et derezzet preset tilbage i udvalget. */
    unhide(name) {
      if (!this.presets[name] || this.names.includes(name)) return;
      this.names = this.allNames.filter((n) => n === name || this.names.includes(n));
    }

    /** Udvalget er alle presets undtagen `hidden` (erstatter tidligere hide/unhide), og kun `only`, hvis sat. */
    setHidden(hidden) {
      this.hiddenSet = new Set(hidden || []);
      this.applyPool();
    }

    /**
     * Kun disse presets (navne, store og små bogstaver er ligegyldige), fx "Classic Winamp mode" med MilkDrops egen
     * pakke; null = alle. Findes ingen af dem, bruges alle, så der altid er noget at vise.
     */
    setOnly(names) {
      this.only = names ? new Set([...names].map((n) => String(n).toLowerCase())) : null;
      this.applyPool();
    }

    applyPool() {
      const gone = this.hiddenSet || new Set();
      const visible = this.allNames.filter((n) => !gone.has(n));
      const only = this.only ? visible.filter((n) => this.only.has(n.toLowerCase())) : visible;
      this.names = only.length ? only : visible;
    }

    /** Fjerner presets fra udvalget (brugerens D, "derez"). Det viste preset bliver stående, til der skiftes. */
    hide(...names) {
      const gone = new Set(names);
      this.names = this.names.filter((n) => !gone.has(n));
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

    /** Brugerens favoritter (K, gemt i indstillingerne): vises oftere. */
    setFavorites(names) {
      this.favorites = new Set(names || []);
    }

    isFavorite(name) {
      return Boolean(this.favorites && this.favorites.has(name));
    }

    /** Vægtes favoritterne? Først når brugeren har mindst FAVORITE_FULL_AT. */
    favoritesWeighted() {
      return Boolean(this.favorites && this.favorites.size >= FAVORITE_FULL_AT);
    }

    /** En favorit, der vægtes (bruges til tillæg og kortere ventetid). */
    weightedFavorite(name) {
      return this.favoritesWeighted() && this.isFavorite(name);
    }

    /** Har de vægtede favoritter allerede fået deres andel af de seneste skift (FAVORITE_CAP)? */
    favoritesCapped() {
      if (!this.favoritesWeighted()) return false;
      return this.history.slice(-FAVORITE_WINDOW).filter((n) => this.isFavorite(n)).length >= FAVORITE_CAP;
    }

    /**
     * Vist for nylig? Favoritter tæller kun de seneste FAVORITE_EXCLUDE skift med, men venter alle, når loftet
     * er nået.
     */
    recentSets() {
      const all = new Set(this.history.slice(-Math.min(RECENT_EXCLUDE, Math.floor(this.names.length / 2))));
      const fav = new Set(this.history.slice(-FAVORITE_EXCLUDE));
      const capped = this.favoritesCapped();
      return (name) => (this.weightedFavorite(name) ? capped || fav.has(name) : all.has(name));
    }

    randomName() {
      const isRecent = this.recentSets();
      if (this.favoritesWeighted() && Math.random() < FAVORITE_SHARE) {
        const favs = this.names.filter((n) => this.isFavorite(n) && !isRecent(n) && !this.failed.has(n));
        if (favs.length) return favs[Math.floor(Math.random() * favs.length)];
      }
      const recent = { has: isRecent };
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
    /** Dino-tilstand (temaet Jurassic): cirka hvert tiende skift bliver en dinosaur. Første gang med det samme. */
    setDinoMode(on) {
      const next = Boolean(on) && this.dinoNames.length > 0;
      if (next && !this.dinoMode) this.dinoCountdown = 0;
      this.dinoMode = next;
    }

    /** Et dinosaur-preset, der ikke er vist for nylig; null uden for dino-tilstand eller før tælleren er løbet ud. */
    dinoName() {
      if (!this.dinoMode) return null;
      if (this.dinoCountdown > 0) {
        this.dinoCountdown -= 1;
        return null;
      }
      this.dinoCountdown = 7 + Math.floor(Math.random() * 6); // 8-13 skift til næste
      const recent = new Set(this.history.slice(-Math.floor(this.dinoNames.length / 2)));
      let pool = this.dinoNames.filter((n) => !recent.has(n) && !this.failed.has(n));
      if (!pool.length) pool = this.dinoNames.filter((n) => n !== this.current && !this.failed.has(n));
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }

    next({ random = true, blendSeconds = 2.7, pick = null } = {}) {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex += 1;
        if (this.load(this.history[this.historyIndex], blendSeconds, { pushHistory: false })) return true;
      }
      const dino = this.dinoName();
      if (dino && this.load(dino, blendSeconds)) return true;
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
     * efter score, så valget følger musikken uden at de samme få presets vinder hver gang. RANDOM_SHARE af
     * gangene trækkes helt tilfældigt blandt dem, der ikke er vist for nylig.
     */
    pickSmart(score, random = Math.random) {
      const isRecent = this.recentSets();
      let pool = this.names.filter((n) => !isRecent(n) && !this.failed.has(n));
      if (pool.length === 0) pool = this.names.filter((n) => n !== this.current && !this.failed.has(n));
      if (pool.length && random() < RANDOM_SHARE) return pool[Math.floor(random() * pool.length)];
      const top = pool
        .map((name) => [name, score(this.profile(name)) + (this.weightedFavorite(name) ? FAVORITE_BONUS : 0)])
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

  /**
   * Brugerens egne lister plus Peters (indstillingen "Use Peter's picks", src/renderer/presets/peter-picks.js).
   * Brugerens egne K og D vinder altid, og Peters valg, brugeren har fortrudt (exceptions), tæller ikke.
   * Returnerer de favoritter og skjulte, der gælder, og hvilke af dem der kun kommer fra Peter.
   */
  function presetLists({ favorites = [], hidden = [], exceptions = [], peter = null } = {}) {
    const own = { fav: new Set(favorites), hidden: new Set(hidden) };
    const skip = new Set(exceptions);
    const peterFav = new Set(((peter && peter.favorites) || []).filter((n) => !skip.has(n) && !own.hidden.has(n) && !own.fav.has(n)));
    const peterHidden = new Set(((peter && peter.derez) || []).filter((n) => !skip.has(n) && !own.fav.has(n) && !own.hidden.has(n)));
    return {
      favorites: new Set([...own.fav, ...peterFav]),
      hidden: new Set([...own.hidden, ...peterHidden]),
      peterFav,
      peterHidden,
    };
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.Visualizer = Visualizer;
  window.Visamp.presetLists = presetLists;
})();
