/*
 * Påskeægget "drew": en hyldest til Drewbraham fra Drewtopia, til "Init" af Nine Inch Nails.
 * Tre faser efter sangens tid (trackTime):
 *   0 → fadeEnd (10,4 s)      Drew toner langsomt frem af mørket, the Grid lyser op. Ingen hamren.
 *   fadeEnd → fullAt (23 s)   bassen sætter ind (første slag 10,45 s): han hamrer, blidt og så hårdere
 *   fullAt →                  fuld styrke: hvert slag banker han mod glasset, skærmen ryster og revner
 * Takten kommer fra beat-kortet (media/init-beats.js, lavet af scripts/make-beatmap.js) ud fra sangens
 * egen tid, så slagene rammer præcist fra første bas-slag. Uden kort eller sangtid bruges musikmotorens
 * slag (beat(e)), og uden dem holder showet selv Inits tempo (93 BPM).
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const COLORS = ['#00e5ff', '#ff8a1e', '#ff2bd6', '#fff36b'];

  class DrewShow {
    /**
     * @param {HTMLElement} root
     * @param {object} o
     *   canvas, img, placeholder, title, sub   elementerne i #drew
     *   lines        tekstlinjer, der skifter for hver takt
     *   level        () => 0..1, hvor kraftig musikken er lige nu
     *   sources      billedfiler, der prøves i rækkefølge
     *   trackTime    () => sekunder inde i sangen (null uden musik; så bruges showets egen tid)
     *   timeOffset   spring frem i showets egen tid (selvtesten)
     *   fadeEnd, fullAt  faseskift i sekunder
     *   beatMap      { beats: [sekunder], downbeats: [indeks] } for sangen
     */
    constructor(root, o) {
      this.root = root;
      this.o = o;
      this.ctx = o.canvas.getContext('2d');
      this.particles = [];
      this.rings = [];
      this.pulse = 0;
      this.down = 0;
      this.flash = 0;
      this.beats = 0;
      this.tilt = 0;
      this.spinStart = -10;
      this.lastBeatAt = -10;
      this.running = false;
      this.fadeEnd = o.fadeEnd || 10.4; // lige før første hørbare bas-slag (10,45 s); Peter har lyttet efter
      this.fullAt = o.fullAt || 23;
      this.fadeOutSeconds = o.fadeOutSeconds || 6; // udtoning i sangens sidste sekunder (outroen fra ca. 122 s)
      this.fadeOut = 1;
      this.intensity = 0;
      this.cracks = [];
      this.stage = o.stage || null;
      this.map = o.beatMap && o.beatMap.beats && o.beatMap.beats.length ? o.beatMap : null;
      this.mapDown = new Set(this.map ? this.map.downbeats : []);
      this.mapIndex = null;
      this.lastSong = null;
    }

    /** Første slag i kortet på eller efter tidspunktet. */
    mapIndexAt(song) {
      const beats = this.map.beats;
      let lo = 0;
      let hi = beats.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] < song) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    /** Sangens tid fra afspilleren, eller null når den ikke kendes. */
    realSongTime() {
      const tt = this.o.trackTime ? this.o.trackTime() : null;
      return Number.isFinite(tt) ? tt : null;
    }

    /** Sekunder inde i sangen. */
    songTime(t) {
      const tt = this.o.trackTime ? this.o.trackTime() : null;
      return Number.isFinite(tt) ? tt : t + (this.o.timeOffset || 0);
    }

    start() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.W = Math.round(window.innerWidth * dpr);
      this.H = Math.round(window.innerHeight * dpr);
      this.o.canvas.width = this.W;
      this.o.canvas.height = this.H;
      this.loadImage(0);
      this.o.sub.textContent = this.o.lines[0] || '';
      this.root.hidden = false;
      this.root.classList.remove('leaving');
      this.running = true;
      this.t0 = performance.now();
      this.last = this.t0;
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
        this.last = now;
        this.now = (now - this.t0) / 1000;
        try {
          this.frame(this.now, dt);
        } catch (err) {
          // Én fejl i et billede må aldrig stoppe animationen; næste billede prøver igen.
          if (!this.loggedError) console.error('Animationsfejl:', err);
          this.loggedError = true;
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    /** Prøver drew.png, drew.jpg, ... Findes ingen, vises en pladsholder. */
    loadImage(i) {
      const { img, placeholder, sources } = this.o;
      if (i >= sources.length) {
        img.hidden = true;
        placeholder.hidden = false;
        return;
      }
      img.onload = () => {
        img.hidden = false;
        placeholder.hidden = true;
      };
      img.onerror = () => this.loadImage(i + 1);
      img.src = sources[i];
    }

    /** Et slag fra musikmotoren. */
    beat(e) {
      if (this.map && this.realSongTime() !== null) return; // beat-kortet styrer takten
      // Tegneløkkens egen tid: performance.now() kan ligge foran billedets tidsstempel.
      const t = this.now || 0;
      this.lastBeatAt = t;
      this.hit(t, Boolean(e && e.downbeat));
    }

    hit(t, downbeat) {
      const k = this.intensity;
      if (k <= 0) return; // stadig i den stille start: Drew toner bare frem
      this.beats += 1;
      this.pulse = 1;
      const cx = this.W / 2;
      const cy = this.H * 0.44;
      this.burst(cx, cy, Math.round((downbeat ? 70 : 26) * k), (downbeat ? 1.4 : 0.8) * (0.5 + 0.5 * k));
      if (downbeat || this.beats % 4 === 0) {
        this.down = k;
        this.flash = 0.35 * k;
        if (k > 0.6) this.crack(t);
        this.tilt = this.tilt > 0 ? -1 : 1;
        this.rings.push({ t, color: COLORS[(this.beats >> 2) % COLORS.length] });
        const lines = this.o.lines;
        this.o.sub.textContent = lines[(this.beats >> 2) % lines.length] || '';
        this.glitch();
      }
      if (this.beats % 16 === 0) this.spinStart = t;
    }

    /** Glasset revner, hvor han banker: takkede lysstreger ud fra midten. */
    crack(t) {
      const cx = this.W / 2;
      const cy = this.H * 0.44;
      const lines = [];
      const n = 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        let a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        let x = cx;
        let y = cy;
        const pts = [[x, y]];
        const reach = Math.min(this.W, this.H) * (0.35 + Math.random() * 0.35);
        for (let d = 0; d < reach; ) {
          const seg = (20 + Math.random() * 45) * this.dpr;
          a += (Math.random() - 0.5) * 0.7;
          x += Math.cos(a) * seg;
          y += Math.sin(a) * seg;
          d += seg;
          pts.push([x, y]);
        }
        lines.push(pts);
      }
      this.cracks.push({ t, lines });
    }

    drawCracks(ctx, t) {
      for (const c of this.cracks) {
        const age = Math.max(0, t - c.t);
        if (age > 1.2) continue;
        ctx.globalAlpha = (1 - age / 1.2) * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * this.dpr;
        ctx.beginPath();
        for (const pts of c.lines) {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.cracks = this.cracks.filter((c) => t - c.t <= 1.2);
    }

    burst(x, y, n, power) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const v = (200 + Math.random() * 700) * power * this.dpr;
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 0.5 + Math.random() * 0.8,
          age: 0,
          size: (2 + Math.random() * 6) * this.dpr,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        });
      }
    }

    /** Titlen hakker, som et signal, der er ved at derezze. */
    glitch() {
      const title = this.o.title;
      title.style.letterSpacing = `${0.05 + Math.random() * 0.5}em`;
      title.style.transform = `skewX(${(Math.random() - 0.5) * 30}deg) translateX(${(Math.random() - 0.5) * 20}px)`;
      clearTimeout(this.glitchTimer);
      this.glitchTimer = setTimeout(() => {
        title.style.letterSpacing = '';
        title.style.transform = '';
      }, 120);
    }

    frame(t, dt) {
      const song = this.songTime(t);
      // Fase: hvor langt Drew er tonet frem, og hvor hårdt han hamrer.
      const fade = clamp(song / this.fadeEnd, 0, 1);
      this.fadeIn = fade * fade * (3 - 2 * fade);
      this.intensity = song < this.fadeEnd ? 0 : clamp(0.35 + (0.65 * (song - this.fadeEnd)) / (this.fullAt - this.fadeEnd), 0.35, 1);
      // Sangens sidste sekunder: Drew, teksten og the Grid toner ud, og hamren ebber af.
      const length = this.o.songLength ? this.o.songLength() : null;
      if (Number.isFinite(length) && length > 0) {
        const out = clamp((length - song) / this.fadeOutSeconds, 0, 1);
        this.fadeOut = out * out * (3 - 2 * out);
      } else {
        this.fadeOut = 1;
      }
      this.fadeIn *= this.fadeOut;
      this.intensity *= this.fadeOut;
      const real = this.realSongTime();
      if (this.map && real !== null) {
        // Beat-kortet: slå på hvert slag, sangen passerer. Et hop tilbage (løkken 67 → 23 s) nulstiller.
        if (this.mapIndex === null || real < this.lastSong - 0.5) this.mapIndex = this.mapIndexAt(real);
        while (this.mapIndex < this.map.beats.length && this.map.beats[this.mapIndex] <= real + 0.015) {
          this.lastBeatAt = t;
          this.hit(t, this.mapDown.has(this.mapIndex));
          this.mapIndex += 1;
        }
        this.lastSong = real;
      }
      // Ingen slag i et stykke tid (hverken kort eller musik): showet holder selv Inits tempo (93 BPM).
      const beatLen = 60 / 93;
      if (!(this.map && real !== null) && t - this.lastBeatAt > 1.4 && Math.floor(t / beatLen) !== this.lastClock) {
        this.lastClock = Math.floor(t / beatLen);
        this.hit(t, this.lastClock % 4 === 0);
      }
      const level = clamp(this.o.level ? this.o.level() : 0.5, 0, 1);
      this.pulse *= Math.exp(-dt * 9);
      this.down *= Math.exp(-dt * 3.5);
      this.flash *= Math.exp(-dt * 9);

      const { ctx, W, H } = this;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(2, 0, 8, 0.32)'; // bevægelsesslør
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      // Baggrunden lyser op, mens Drew toner frem, og går amok, når han hamrer.
      const glow = 0.18 + 0.4 * this.fadeIn + 0.42 * this.intensity;
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.globalAlpha = glow;
      this.drawFloor(ctx, t, level * this.intensity);
      this.drawRays(ctx, t, level * this.intensity);
      ctx.restore();
      this.drawRings(ctx, t);
      this.drawParticles(ctx, dt);
      this.drawCracks(ctx, t);
      if (this.flash > 0.01) {
        ctx.globalAlpha = this.flash;
        ctx.fillStyle = COLORS[(this.beats >> 2) % COLORS.length];
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      this.moveImage(t, level);
    }

    /** Et Tron-gulv i perspektiv, der suser mod seeren. */
    drawFloor(ctx, t, level) {
      const { W, H } = this;
      const horizon = H * 0.62;
      const speed = 0.6 + level * 2.2 + this.pulse;
      this.floorPhase = ((this.floorPhase || 0) + speed * 0.016) % 1;
      const color = (this.beats >> 3) % 2 ? '255, 138, 30' : '0, 229, 255';
      ctx.lineWidth = 2 * this.dpr;
      for (let i = 0; i < 14; i++) {
        const z = (i + this.floorPhase) / 14; // 0 ved horisonten, 1 tæt på
        const y = horizon + (H - horizon) * z * z;
        ctx.strokeStyle = `rgba(${color}, ${0.15 + 0.6 * z})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        ctx.strokeStyle = `rgba(${color}, 0.35)`;
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * W * 0.02, horizon);
        ctx.lineTo(W / 2 + i * W * 0.16, H);
        ctx.stroke();
      }
      const glow = ctx.createLinearGradient(0, horizon - H * 0.05, 0, horizon + H * 0.02);
      glow.addColorStop(0, 'rgba(0,0,0,0)');
      glow.addColorStop(0.7, `rgba(${color}, ${0.25 + 0.4 * this.down})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, horizon - H * 0.05, W, H * 0.07);
    }

    drawRays(ctx, t, level) {
      const { W, H } = this;
      const cx = W / 2;
      const cy = H * 0.44;
      const n = 18;
      const len = Math.max(W, H);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * (0.3 + level * 0.8));
      for (let i = 0; i < n; i++) {
        ctx.rotate(TAU / n);
        ctx.globalAlpha = 0.05 + 0.12 * this.pulse;
        ctx.fillStyle = COLORS[i % 2];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(len, -len * 0.04);
        ctx.lineTo(len, len * 0.04);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // Identitetsdiske, der drejer om billedet.
      const base = Math.min(W, H) * 0.3 * (1 + 0.15 * this.pulse);
      ctx.lineWidth = 5 * this.dpr;
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = COLORS[(k + (this.beats >> 2)) % 3];
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        const start = t * (k % 2 ? -1.6 : 2.1) + k;
        ctx.arc(cx, cy, base * (1 + k * 0.18), start, start + TAU * 0.7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawRings(ctx, t) {
      const cx = this.W / 2;
      const cy = this.H * 0.44;
      for (const ring of this.rings) {
        const age = Math.max(0, t - ring.t);
        if (age > 0.8) continue;
        ctx.globalAlpha = 1 - age / 0.8;
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 8 * this.dpr * (1 - age / 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(this.W, this.H) * age, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.rings = this.rings.filter((ring) => t - ring.t <= 0.8);
    }

    drawParticles(ctx, dt) {
      for (const p of this.particles) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        const a = clamp(1 - p.age / p.life, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      this.particles = this.particles.filter((p) => p.age < p.life);
    }

    /**
     * Billedet: toner frem af mørket, og hamrer så mod skærmen. Hvert slag skyder ham frem mod
     * seeren (skala), skærmen ryster, han vipper på taktstart, drejer rundt hver 16. slag og splittes
     * i cyan og orange.
     */
    moveImage(t, level) {
      const el = this.o.img.hidden ? this.o.placeholder : this.o.img;
      const k = this.intensity;
      const fadeIn = this.fadeIn;
      const pound = this.pulse * k;
      const breathe = 1 + 0.02 * Math.sin(t * 1.3);
      const scale = (0.86 + 0.14 * fadeIn) * breathe + (0.12 + 0.55 * k) * pound + 0.12 * this.down;
      const bounce = -20 * pound + Math.sin(t * 5) * 5 * (0.2 + level) * k;
      const tilt = this.tilt * 10 * this.down + Math.sin(t * 1.7) * 3 * (0.3 + k);
      const spin = clamp((t - this.spinStart) / 0.7, 0, 1);
      const spinY = spin < 1 ? spin * 360 : 0;
      const split = (3 + 22 * this.pulse) * (0.3 + 0.7 * k);
      el.style.opacity = String(fadeIn);
      el.style.transform = `translateY(${bounce}px) rotate(${tilt}deg) rotateY(${spinY}deg) scale(${scale})`;
      el.style.filter =
        `brightness(${0.25 + 0.75 * fadeIn + 0.4 * pound}) ` +
        `drop-shadow(${split}px 0 0 rgba(0, 229, 255, 0.85)) drop-shadow(${-split}px 0 0 rgba(255, 138, 30, 0.85)) ` +
        `drop-shadow(0 0 ${10 + 30 * fadeIn + 50 * pound}px rgba(255, 255, 255, ${0.2 + 0.3 * fadeIn + 0.3 * this.down})) saturate(${1 + this.down})`;
      // Skærmen ryster, når han banker på den.
      if (this.stage) {
        const shake = 22 * pound * this.dpr;
        this.stage.style.transform = shake > 0.5 ? `translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px)` : '';
      }
      // Titlen toner frem sidst i den stille start.
      const titleIn = clamp((fadeIn - 0.55) / 0.45, 0, 1);
      this.o.title.style.opacity = String(titleIn);
      this.o.sub.style.opacity = String(k > 0 ? this.fadeOut : 0);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.glitchTimer);
      if (this.stage) this.stage.style.transform = '';
      this.root.classList.add('leaving');
      setTimeout(() => {
        this.root.hidden = true;
        this.root.classList.remove('leaving');
      }, 350);
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.DrewShow = DrewShow;
})();
