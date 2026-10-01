/*
 * Preset-test (`--presettest`): tegner hvert konverteret preset med syntetisk musik og måler, om det
 * virker, og hvor godt det er. Resultaterne bruges af scripts/build-preset-pack.js til at vælge de bedste.
 *
 * For hvert preset: 1 s stilhed, så 2 s musik (120 BPM: kick, bas, hi-hat og en akkord), tegnet så hurtigt
 * som muligt med faste tidsskridt (1/60 s). Et lille billede (48x27) tages hvert andet billede. Målinger:
 *   linkFailed   shaderen kunne ikke oversættes (WebGL-programmet blev ikke linket)
 *   error        loadPreset/render kastede en fejl
 *   luma         gennemsnitlig lysstyrke 0-1 (sort eller helt hvidt er dårligt)
 *   colorful     farvemætning (spredning mellem R, G og B)
 *   detail       rumlig variation (et fladt billede er kedeligt)
 *   motion       gennemsnitlig ændring mellem billeder under musikken
 *   silentMotion ... og under stilheden
 *   beatSync     korrelation mellem billedets ændring og kick-slagene (0-1): følger det musikken?
 *   msPerFrame   tid pr. billede ved 1280x720 (GPU-belastning)
 */
(function () {
  'use strict';

  const W = 1280;
  const H = 720;
  const SR = 44100;
  const N = 1024;
  const FPS = 60;
  const BPM = 120;
  const SMALL_W = 48;
  const SMALL_H = 27;

  const unwrap = (m) => (m && m.default ? m.default : m);
  const canvas = document.getElementById('viz');
  const butterchurn = unwrap(window.butterchurn);
  const audioContext = new AudioContext();
  const viz = butterchurn.createVisualizer(audioContext, canvas, { width: W, height: H, pixelRatio: 1, textureRatio: 1 });
  const extra = unwrap(window.butterchurnExtraImages);
  if (extra && extra.getImages) viz.loadExtraImages(extra.getImages());

  // Fang shadere, der ikke kan oversættes: Butterchurn melder det ikke selv.
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  let linkFailures = 0;
  let linkLog = '';
  const link = gl.linkProgram.bind(gl);
  gl.linkProgram = (program) => {
    link(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      linkFailures += 1;
      // Oversætterens fejl (til at finde fejl i konverteringen af shaderne).
      if (!linkLog) {
        for (const shader of gl.getAttachedShaders(program) || []) {
          const info = gl.getShaderInfoLog(shader);
          if (info) linkLog += info.slice(0, 300);
        }
      }
    }
  };

  const small = document.createElement('canvas');
  small.width = SMALL_W;
  small.height = SMALL_H;
  const sctx = small.getContext('2d', { willReadFrequently: true });

  // Syntetisk musik som tidsdomæne-bytes (0-255, 128 = stilhed), N samples frem til tiden t.
  let noiseSeed = 1;
  const noise = () => ((noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const beat = 60 / BPM;
  function kickAt(t) {
    const since = ((t % beat) + beat) % beat;
    return Math.exp(-since / 0.12);
  }
  function music(t, silent) {
    const out = new Uint8Array(N);
    if (silent) return out.fill(128);
    for (let i = 0; i < N; i++) {
      const s = t - (N - i) / SR;
      const since = ((s % beat) + beat) % beat;
      const kick = Math.exp(-since / 0.12) * Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-since / 0.03)) * since);
      const hatSince = ((s % (beat / 2)) + beat / 2) % (beat / 2);
      const hat = Math.exp(-hatSince / 0.02) * noise();
      const bar = Math.floor(s / (4 * beat)) % 4;
      const root = [55, 55, 65.4, 49][bar];
      const bass = Math.sin(2 * Math.PI * root * 2 * s);
      const chord = Math.sin(2 * Math.PI * root * 8 * s) + Math.sin(2 * Math.PI * root * 10 * s) + Math.sin(2 * Math.PI * root * 12 * s);
      const x = 0.75 * kick + 0.2 * hat + 0.2 * bass + 0.05 * chord;
      out[i] = Math.max(0, Math.min(255, Math.round(128 + 127 * x)));
    }
    return out;
  }

  function snapshot() {
    sctx.drawImage(canvas, 0, 0, SMALL_W, SMALL_H);
    return sctx.getImageData(0, 0, SMALL_W, SMALL_H).data;
  }

  function stats(img) {
    let luma = 0;
    let chroma = 0;
    const n = SMALL_W * SMALL_H;
    const l = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = img[4 * i] / 255;
      const g = img[4 * i + 1] / 255;
      const b = img[4 * i + 2] / 255;
      l[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma += l[i];
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
    }
    luma /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (l[i] - luma) ** 2;
    return { luma, colorful: chroma / n, detail: Math.sqrt(v / n), l };
  }

  const diff = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
  };

  function corr(a, b) {
    const n = Math.min(a.length, b.length);
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) {
      ma += a[i];
      mb += b[i];
    }
    ma /= n;
    mb /= n;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < n; i++) {
      sab += (a[i] - ma) * (b[i] - mb);
      saa += (a[i] - ma) ** 2;
      sbb += (b[i] - mb) ** 2;
    }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  function test(preset) {
    const result = {};
    linkFailures = 0;
    linkLog = '';
    let t = 0;
    const step = (silent) => {
      t += 1 / FPS;
      const bytes = music(t, silent);
      viz.render({ audioLevels: { timeByteArray: bytes, timeByteArrayL: bytes, timeByteArrayR: bytes }, elapsedTime: 1 / FPS });
    };
    try {
      viz.loadPreset(preset, 0);
      // Stilhed: 1 s, billeder de sidste 0,5 s.
      const silentShots = [];
      for (let f = 0; f < FPS; f++) {
        step(true);
        if (f >= FPS / 2 && f % 6 === 0) silentShots.push(stats(snapshot()).l);
      }
      // Musik: 2 s, et billede hvert andet billede.
      const shots = [];
      const kicks = [];
      const started = performance.now();
      for (let f = 0; f < 2 * FPS; f++) {
        step(false);
        if (f % 2 === 0) {
          shots.push(stats(snapshot()));
          kicks.push(kickAt(t));
        }
      }
      const elapsed = performance.now() - started;
      // Rendertid uden målinger: 20 billeder, synkroniseret med readPixels.
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let f = 0; f < 20; f++) step(false);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      result.msPerFrame = Math.round(((performance.now() - t0) / 20) * 10) / 10;
      result.measureMs = Math.round(elapsed);

      const avgOf = (k) => shots.reduce((s, x) => s + x[k], 0) / shots.length;
      result.luma = avgOf('luma');
      result.colorful = avgOf('colorful');
      result.detail = avgOf('detail');
      const changes = [];
      for (let i = 1; i < shots.length; i++) changes.push(diff(shots[i].l, shots[i - 1].l));
      result.motion = changes.reduce((s, x) => s + x, 0) / changes.length;
      const silentChanges = [];
      for (let i = 1; i < silentShots.length; i++) silentChanges.push(diff(silentShots[i], silentShots[i - 1]));
      result.silentMotion = silentChanges.length ? silentChanges.reduce((s, x) => s + x, 0) / silentChanges.length : 0;
      // Følger billedet slagene? Korrelation mellem ændringen og kick-kurven, med op til 3 målinger forsinkelse.
      let best = 0;
      for (let lag = 0; lag <= 3; lag++) best = Math.max(best, corr(changes.slice(lag), kicks.slice(1, kicks.length - lag)));
      // ... og lysstyrken selv (nogle presets blinker på slaget i stedet for at bevæge sig).
      const lumas = shots.map((s) => s.luma);
      for (let lag = 0; lag <= 3; lag++) best = Math.max(best, corr(lumas.slice(lag), kicks.slice(0, kicks.length - lag)));
      result.beatSync = Math.max(0, best);
    } catch (err) {
      result.error = String((err && err.message) || err).slice(0, 200);
    }
    result.linkFailed = linkFailures > 0;
    if (linkLog) result.linkLog = linkLog;
    for (const k of ['luma', 'colorful', 'detail', 'motion', 'silentMotion', 'beatSync']) {
      if (typeof result[k] === 'number') result[k] = Math.round(result[k] * 10000) / 10000;
    }
    return result;
  }

  (async () => {
    for (let start = 0; ; start += 20) {
      const batch = await window.visamp.presettest.batch(start, 20);
      if (!batch || !batch.length) break;
      const results = [];
      for (const item of batch) {
        let preset = null;
        try {
          preset = JSON.parse(item.json);
        } catch (err) {
          results.push({ file: item.file, error: 'invalid json' });
          continue;
        }
        results.push({ file: item.file, ...test(preset) });
      }
      // Gemmes efter hver portion, så en afbrudt kørsel kan fortsætte.
      await window.visamp.presettest.results(results);
      await new Promise((r) => setTimeout(r, 0));
    }
    return { ok: true };
  })()
    .then((report) => window.visamp.presettest.report(report))
    .catch((err) => window.visamp.presettest.report({ ok: false, error: String((err && err.stack) || err) }));
})();
