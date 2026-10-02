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
  // Højeste renderbredde i skærmpixels. 3840 er en 4K-skærm i fuld skærm, så den tegnes 1:1 (loftet var 2560 og blev
  // strakt 1,5 gange på 4K). Bredere (5K, 8K, et vindue over flere skærme) koster mange gange så meget GPU uden synlig
  // gevinst: Butterchurn tegner flere fulde pas pr. billede (warp, slør, comp, FXAA).
  const MAX_RENDER_WIDTH = 3840;
  // Butterchurns tekstur = canvas = skærmpixels (pixelRatio og textureRatio 1; over 1 er supersampling, som kun virker
  // med FXAA og koster 4 gange GPU, se .claude/plans/2026-10-02-visualizer-research.md). Mesh 64x48 i stedet for
  // standarden 48x36: finere warp-bevægelse (1,76 gange så mange punkter i preset-ligningerne, på CPU'en).
  // outputFXAA udjævner kanterne på 1-px-linjer i et ekstra pas.
  const RENDER_OPTIONS = { pixelRatio: 1, textureRatio: 1, meshWidth: 64, meshHeight: 48, outputFXAA: true };
  // Butterchurns egne kontekst-attributter (butterchurn.js:6498) plus den hurtige GPU på bærbare med to grafikkort.
  // Konteksten oprettes før createVisualizer, og Butterchurns getContext('webgl2') får den samme tilbage.
  const GL_ATTRIBUTES = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' };
  // Størrelsesskift samles: preset-listens træk ændrer bredden på hvert musetræk, og hvert skift genopretter
  // Butterchurns teksturer. Det første skift efter en pause sker med det samme, resten 100 ms efter det sidste.
  const RESIZE_DEBOUNCE_MS = 100;
  // Lysstyrken til blink-vagten måles på et lille billede som preset-testens (presettest.js: 48x27).
  const LUMA_W = 48;
  const LUMA_H = 27;
  const LUMA_SLOTS = 3; // aflæsninger, der må være undervejs fra GPU'en
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

  /** Gennemsnitlig lysstyrke (0-1) af RGBA-bytes. */
  function lumaOf(d) {
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / ((d.length / 4) * 255);
  }

  /** Grafikkortets navn (til konsollen og selvtesten). */
  function gpuName(gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }

  /**
   * Lysstyrken af det netop tegnede billede uden at vente på GPU'en. Før: drawImage af hele WebGL-billedet ind i et
   * 2D-canvas med willReadFrequently, dvs. en fuld kopi GPU → CPU (op til 33 MB ved 4K) hvert andet billede. Nu:
   * billedet skaleres ned på GPU'en (blitFramebuffer til 48x27), pixels kopieres asynkront ind i en buffer
   * (PIXEL_PACK_BUFFER), og et hegn (fenceSync) siger, hvornår de er klar. Svaret kommer 1-2 billeder senere og er
   * 5 KB. Kaldes lige efter render() i samme rAF, før browseren viser og rydder billedet (preserveDrawingBuffer er
   * false). Butterchurns GL-tilstand (framebuffere, pixel-buffer, scissor) lægges tilbage, som den var.
   */
  class LumaProbe {
    constructor(gl) {
      this.gl = gl;
      this.failed = null; // grund, hvis aflæsningen ikke virker her; så bruger visualizeren drawImage
      this.checked = false;
      this.seq = 0;
      this.pixels = new Uint8Array(LUMA_W * LUMA_H * 4);
      const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      this.renderbuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.renderbuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, LUMA_W, LUMA_H);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      this.framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
      gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.renderbuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      this.slots = Array.from({ length: LUMA_SLOTS }, () => {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl.STREAM_READ);
        return { buffer, sync: null, seq: 0 };
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }

    /** Beder om lysstyrken af canvas-billedet (width x height). false: alle pladser er optaget, målingen springes over. */
    capture(width, height) {
      const gl = this.gl;
      const slot = this.slots.find((s) => !s.sync);
      if (!slot) return false; // GPU'en er bagud; hellere en måling for lidt end at vente
      if (!this.checked) {
        // Første gang: ryd gamle fejl-flag, så en fejl bagefter er vores (getError venter på GPU-processen).
        for (let e = gl.getError(), n = 0; e !== gl.NO_ERROR && n < 8; e = gl.getError(), n++) {
          console.warn(`WebGL error before the luma check: 0x${e.toString(16)}`);
        }
      }
      const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
      const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      const scissor = gl.isEnabled(gl.SCISSOR_TEST);
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); // canvas-billedet
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, LUMA_W, LUMA_H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
      // Nyt lager hver gang (orphaning): ANGLE laver en skyggekopi af en READ-buffer ved hegnet, og skrives bufferen
      // igen, mens den kopi findes, smides den væk med en advarsel pr. måling (selvtesten 02-10-2026). Bufferen er
      // 5 KB, så genallokeringen koster intet.
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl.STREAM_READ);
      gl.readPixels(0, 0, LUMA_W, LUMA_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      slot.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      slot.seq = ++this.seq;
      gl.flush(); // så hegnet når GPU'en med det samme
      if (!this.checked) {
        this.checked = true;
        const error = gl.getError();
        if (error !== gl.NO_ERROR) this.failed = `WebGL error 0x${error.toString(16)}`;
      }
      return true;
    }

    /** Leverer de færdige målinger (ældste først) til onLuma uden at vente. */
    poll(onLuma) {
      const gl = this.gl;
      const pending = this.slots.filter((s) => s.sync).sort((a, b) => a.seq - b.seq);
      for (const slot of pending) {
        const status = gl.clientWaitSync(slot.sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) return;
        gl.deleteSync(slot.sync);
        slot.sync = null;
        if (status === gl.WAIT_FAILED) {
          this.failed = 'clientWaitSync failed';
          return;
        }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        onLuma(lumaOf(this.pixels));
      }
    }

    /** Glemmer aflæsninger undervejs (visualizeren stopper). */
    cancel() {
      for (const slot of this.slots) {
        if (!slot.sync) continue;
        this.gl.deleteSync(slot.sync);
        slot.sync = null;
      }
    }

    dispose() {
      const gl = this.gl;
      this.cancel();
      for (const slot of this.slots) gl.deleteBuffer(slot.buffer);
      gl.deleteFramebuffer(this.framebuffer);
      gl.deleteRenderbuffer(this.renderbuffer);
    }
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
    /** `lumaRate`: målinger af lysstyrken i sekundet til onLuma (blink-vagtens SAMPLE_RATE). */
    constructor(canvas, { audioContext, onPresetChange, lumaRate = 30 } = {}) {
      const butterchurn = unwrap(window.butterchurn);
      if (!butterchurn || typeof butterchurn.createVisualizer !== 'function') {
        throw new Error('Butterchurn could not be loaded.');
      }
      const pacing = window.VisampFramePacer;
      if (!pacing) throw new Error('frame-pacer.js is not loaded.');
      this.canvas = canvas;
      this.onPresetChange = onPresetChange;
      this.audioContext = audioContext || new AudioContext({ latencyHint: 'interactive' });
      this.presets = collectPresets();
      this.names = Object.keys(this.presets).sort((a, b) => a.localeCompare(b, 'en'));
      this.allNames = this.names.slice(); // også de skjulte (derezzede), til preset-listen
      this.failed = new Set();
      this.history = [];
      this.historyIndex = -1;
      this.current = null;
      this.frames = 0;
      this.running = false;
      // Billedtakten: højst ca. 60 billeder i sekundet (src/shared/frame-pacer.js), og målinger til selvtesten.
      this.pacer = new pacing.FramePacer();
      this.renderStats = new pacing.FrameStats(); // CPU-tid pr. tegnet billede
      this.awakeMs = 0; // tid, visualizeren har tegnet (den sover uden musik)
      this.startedAt = null;
      this.lumaRate = lumaRate;
      this.lastLumaAt = -Infinity;
      this.lumaSamples = 0;
      this.devicePixels = null; // præcise skærmpixels fra ResizeObserver, når Chromium giver dem
      this.lastSizeChange = -Infinity;

      const { width, height } = this.measure();
      canvas.width = width;
      canvas.height = height;
      this.gl = canvas.getContext('webgl2', GL_ATTRIBUTES);
      if (!this.gl) throw new Error('WebGL 2 is not available.');
      this.isWebGL2 = true;
      this.gpu = gpuName(this.gl);
      console.info('WebGL renderer:', this.gpu);
      this.viz = butterchurn.createVisualizer(this.audioContext, canvas, { width, height, ...RENDER_OPTIONS });
      this.lumaProbe = new LumaProbe(this.gl);
      this.lumaMethod = 'gpu-readback';

      this.installTransitions();
      this.punchK = 1; // slået til med setPunch (indstillingen "Punch")
      this.installPunch();

      const extraImages = unwrap(window.butterchurnExtraImages);
      if (extraImages && typeof extraImages.getImages === 'function') {
        this.viz.loadExtraImages(extraImages.getImages());
      }

      this.observeSize();
    }

    /**
     * Canvas-størrelsen følger elementets præcise skærmpixels: ResizeObserver med 'device-pixel-content-box' giver
     * dem uden afrunding (CSS-størrelse x devicePixelRatio kan ramme 1 px ved siden af) og melder også et skift af
     * devicePixelRatio (Windows-skalering, vinduet flyttet til en anden skærm). Uden den måles med CSS-pixels x
     * devicePixelRatio, og et skift af devicePixelRatio fanges med matchMedia.
     */
    observeSize() {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        const box = entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
        this.devicePixels = box ? { width: box.inlineSize, height: box.blockSize } : null;
        this.scheduleResize();
      });
      try {
        this.resizeObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
      } catch (err) {
        console.warn('ResizeObserver without device-pixel-content-box; sizing from CSS pixels x devicePixelRatio:', err);
        this.resizeObserver.observe(this.canvas);
      }
      this.watchPixelRatio();
    }

    watchPixelRatio() {
      const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query.addEventListener(
        'change',
        () => {
          this.scheduleResize();
          this.watchPixelRatio();
        },
        { once: true }
      );
    }

    /** Renderstørrelsen i skærmpixels, højst MAX_RENDER_WIDTH bred (så strækkes billedet af browseren). */
    measure() {
      let width;
      let height;
      if (this.devicePixels) {
        ({ width, height } = this.devicePixels);
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        width = Math.round(rect.width * dpr);
        height = Math.round(rect.height * dpr);
      }
      width = Math.max(2, width);
      height = Math.max(2, height);
      this.screenSize = { width, height };
      if (width > MAX_RENDER_WIDTH) {
        height = Math.max(2, Math.round((height * MAX_RENDER_WIDTH) / width));
        width = MAX_RENDER_WIDTH;
      }
      return { width, height };
    }

    /** Se RESIZE_DEBOUNCE_MS: første skift med det samme, under et træk kun det sidste. */
    scheduleResize(now = performance.now()) {
      const quiet = now - this.lastSizeChange > RESIZE_DEBOUNCE_MS;
      this.lastSizeChange = now;
      clearTimeout(this.resizeTimer);
      if (quiet) this.resize();
      else this.resizeTimer = setTimeout(() => this.resize(), RESIZE_DEBOUNCE_MS);
    }

    resize() {
      const { width, height } = this.measure();
      if (width === this.canvas.width && height === this.canvas.height) return;
      this.canvas.width = width;
      this.canvas.height = height;
      this.viz.setRendererSize(width, height, RENDER_OPTIONS);
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
     * Render-løkken: requestAnimationFrame kommer med skærmens opdateringsrate, men Butterchurn tegner kun, når
     * FramePacer siger til (højst ca. 60 gange i sekundet), fordi presets bevæger sig pr. billede. Musikmotoren og
     * Tron-laget har deres egne løkker og påvirkes ikke.
     */
    start() {
      if (this.running) return;
      this.running = true;
      this.startedAt = performance.now();
      this.pacer.resume();
      const loop = (ts) => {
        if (!this.running) return;
        try {
          if (this.lumaProbe) this.pollLuma();
          if (this.pacer.tick(ts)) this.renderFrame(ts);
        } catch (err) {
          console.error('Render error:', err);
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    renderFrame(ts) {
      const t0 = performance.now();
      this.viz.render();
      this.frames += 1;
      // Billedets lysstyrke til blink-vagten (src/shared/flash-guard.js) med ca. lumaRate målinger i sekundet, efter
      // tid, så vagtens tærskler gælder ved enhver billedrate: ved 60 fps hvert andet billede (30/s), ved 72 fps 36/s,
      // ved 55 fps 27,5/s. Grænsen er 3/4 af intervallet, så rAF-rystelser ikke springer et ekstra billede over.
      if (this.onLuma && ts - this.lastLumaAt >= 750 / this.lumaRate) {
        this.lastLumaAt = ts;
        this.sampleLuma();
      }
      this.renderStats.add(performance.now() - t0);
    }

    sampleLuma() {
      if (!this.lumaProbe) {
        this.deliverLuma(this.measureLuma());
        return;
      }
      // drawingBuffer-størrelsen, ikke canvas-størrelsen: browseren kan give en mindre tegnebuffer end bedt om.
      this.lumaProbe.capture(this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
      if (this.lumaProbe.failed) this.dropLumaProbe();
    }

    pollLuma() {
      this.lumaProbe.poll((luma) => this.deliverLuma(luma));
      if (this.lumaProbe.failed) this.dropLumaProbe();
    }

    deliverLuma(luma) {
      this.lumaSamples += 1;
      if (this.onLuma) this.onLuma(luma);
    }

    /** GPU-aflæsningen virker ikke på denne pc: tilbage til den langsommere kopi via et 2D-canvas (sagt i konsollen). */
    dropLumaProbe() {
      console.warn(`Luma readback failed (${this.lumaProbe.failed}); the flash guard uses a canvas copy instead.`);
      this.lumaProbe.dispose();
      this.lumaProbe = null;
      this.lumaMethod = 'canvas-copy';
    }

    /** Reserve uden GPU-aflæsning: lysstyrken via drawImage til et lille 2D-canvas (en fuld kopi af billedet). */
    measureLuma() {
      if (!this.lumaCanvas) {
        this.lumaCanvas = document.createElement('canvas');
        this.lumaCanvas.width = LUMA_W;
        this.lumaCanvas.height = LUMA_H;
        this.lumaCtx = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
      }
      this.lumaCtx.drawImage(this.canvas, 0, 0, LUMA_W, LUMA_H);
      return lumaOf(this.lumaCtx.getImageData(0, 0, LUMA_W, LUMA_H).data);
    }

    stop() {
      if (this.running) this.awakeMs += performance.now() - this.startedAt;
      this.running = false;
      cancelAnimationFrame(this.raf);
      if (this.lumaProbe) this.lumaProbe.cancel();
    }

    /** Sekunder, visualizeren har tegnet i alt. */
    awakeSeconds() {
      return (this.awakeMs + (this.running ? performance.now() - this.startedAt : 0)) / 1000;
    }

    /** Nulstiller billedtiderne (selvtesten måler sit eget vindue). */
    resetStats() {
      this.pacer.resetStats();
      this.renderStats.reset();
      this.lumaSamples = 0;
    }

    /** Opløsning, billedtakt og billedtider til selvtesten (engelske nøgler). */
    renderInfo() {
      const rect = this.canvas.getBoundingClientRect();
      const r = (x, digits = 2) => (x === null ? null : Math.round(x * 10 ** digits) / 10 ** digits);
      return {
        size: `${this.canvas.width}x${this.canvas.height}`,
        screenPixels: this.screenSize ? `${this.screenSize.width}x${this.screenSize.height}` : null,
        cssSize: `${r(rect.width)}x${r(rect.height)}`,
        devicePixelRatio: window.devicePixelRatio,
        devicePixelBox: Boolean(this.devicePixels),
        capped: Boolean(this.screenSize && this.screenSize.width > MAX_RENDER_WIDTH),
        mesh: `${RENDER_OPTIONS.meshWidth}x${RENDER_OPTIONS.meshHeight}`,
        fxaa: RENDER_OPTIONS.outputFXAA,
        gpu: this.gpu,
        refreshHz: r(this.pacer.refreshHz, 1),
        divisor: this.pacer.divisor,
        targetFps: r(this.pacer.targetFps, 1),
        frameTimeMs: this.pacer.frameStats.summary(),
        rafIntervalMs: this.pacer.rafStats.summary(),
        renderCpuMs: this.renderStats.summary(),
        lumaMethod: this.lumaMethod,
        lumaSamples: this.lumaSamples,
      };
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

    /**
     * Punch (src/shared/punch.js): Butterchurns lydniveauer (bass, mid, treb og _att) får mere kontrast omkring 1,0,
     * så presets reagerer tydeligere på slagene. Lægges om `renderer.audioLevels`, som render() og loadPreset() læser.
     */
    installPunch() {
      const renderer = this.viz && this.viz.renderer;
      if (!renderer || !renderer.audioLevels) {
        console.warn('Punch: Butterchurn has no renderer.audioLevels; punch is not installed.');
        return;
      }
      renderer.audioLevels = window.VisampPunch.wrapAudioLevels(renderer.audioLevels, () => this.punchK);
      this.punchInstalled = true; // selvtesten melder, om krogen sidder
    }

    /** Punch til eller fra (fra = Butterchurns egne niveauer, k = 1). */
    setPunch(on) {
      this.punchK = on ? window.VisampPunch.PUNCH_K : 1;
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

    /** Udvalget er alle presets undtagen `hidden` (erstatter tidligere hide/unhide). */
    setHidden(hidden) {
      const gone = new Set(hidden || []);
      this.names = this.allNames.filter((n) => !gone.has(n));
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
  window.Visamp.LumaProbe = LumaProbe; // til test/visualizer-render.test.js
  window.Visamp.presetLists = presetLists;
})();
