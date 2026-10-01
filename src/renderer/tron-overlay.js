/*
 * Tron-laget over MilkDrop (slås til og fra med "tron" i Flynns terminal): et perspektivgulv, der ruller med
 * tempoet og lyser op på slagene, lyscykler, der kører hen over gulvet på drops og ind imellem på en
 * taktstart, og et kort derez-glimt på hårde klip. Tegnes additivt ("lighter"), så MilkDrop stadig er
 * hovedsagen. Musikmotorens hændelser kommer ind via beat() og event().
 */
(function () {
  'use strict';

  const PALETTES = {
    grid: { line: [0, 229, 255], accent: [255, 138, 28] },
    clu: { line: [255, 138, 28], accent: [0, 229, 255] },
    classic: { line: [70, 255, 120], accent: [255, 220, 60] },
  };
  const HORIZON = 0.6; // horisonten i andele af højden
  const NEAR = 1; // gulvets nærmeste dybde
  const FAR = 14; // gulvets fjerneste dybde
  const SIDE = 9; // gulvets halve bredde i gulv-enheder
  const MAX_PIXEL_RATIO = 1.5;

  const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

  class TronOverlay {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.enabled = false;
      this.asleep = false;
      this.visibility = 0; // 0-1: toner ind og ud
      this.palette = PALETTES.grid;
      this.bpm = 120;
      this.scroll = 0; // gulvets rulning i gulv-enheder
      this.pulse = 0; // lys fra det seneste slag (0-1)
      this.sweep = null; // lysstreg fra horisonten mod beskueren ved en ny del (0-1)
      this.derez = 0; // derez-glimt ved et hårdt klip (0-1)
      this.cycles = [];
      this.downbeats = 0;
      this.lastT = null;
      this.raf = null;
      this.frame = (ms) => this.loop(ms);
    }

    setEnabled(on) {
      this.enabled = Boolean(on);
      if (this.enabled) {
        this.canvas.hidden = false;
        this.start();
      }
    }

    setTheme(theme) {
      this.palette = PALETTES[theme] || PALETTES.grid;
    }

    setTempo(bpm) {
      if (bpm && bpm > 30 && bpm < 300) this.bpm = bpm;
    }

    /** Ingen musik: laget toner ud sammen med visualiseringen. */
    setAsleep(asleep) {
      this.asleep = Boolean(asleep);
    }

    /** Et slag fra musikmotoren. */
    beat(e) {
      if (!this.enabled) return;
      if (e && e.bpm) this.setTempo(e.bpm);
      const down = Boolean(e && e.downbeat);
      this.pulse = Math.max(this.pulse, down ? 1 : 0.55);
      if (down) {
        this.downbeats += 1;
        // Ind imellem kører en enkelt lyscykel forbi på en taktstart.
        if (this.downbeats % 8 === 0) this.spawnCycle();
      }
    }

    /** 'drop' (lyscykler og fuldt lys), 'section' (lysstreg mod beskueren) eller 'cut' (derez). */
    event(type) {
      if (!this.enabled) return;
      if (type === 'drop') {
        this.pulse = 1;
        this.spawnCycle(0);
        this.spawnCycle(1);
        this.spawnCycle(Math.random() < 0.5 ? 0 : 1);
      } else if (type === 'section') {
        this.sweep = 0;
      } else if (type === 'cut') {
        this.derez = 1;
      }
    }

    /** En lyscykel på tværs af gulvet i en tilfældig dybde, fra venstre eller højre, i laget eller accentfarven. */
    spawnCycle(colorIndex = Math.random() < 0.6 ? 0 : 1) {
      if (this.cycles.length > 6) return;
      const fromLeft = Math.random() < 0.5;
      const z = 2.2 + Math.random() * 7;
      this.cycles.push({
        x: fromLeft ? -SIDE - 1 : SIDE + 1,
        z,
        dir: fromLeft ? 1 : -1,
        speed: 7 + Math.random() * 5,
        // Halvvejs kan den dreje 90 grader mod beskueren, som i spillet.
        turnAt: Math.random() < 0.5 ? (Math.random() - 0.5) * SIDE : null,
        turned: false,
        color: colorIndex === 0 ? this.palette.line : this.palette.accent,
        trail: [],
        dead: false,
      });
    }

    start() {
      if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const w = Math.max(2, Math.round(rect.width * dpr));
      const h = Math.max(2, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      return { w, h };
    }

    /** Gulv-koordinater (x til siden, z i dybden) til skærmen. */
    project(x, z, w, h) {
      const horizon = h * HORIZON;
      const scale = (w * 0.5) / SIDE;
      return { x: w / 2 + (x / z) * scale * NEAR * 1.6, y: horizon + ((h - horizon) * NEAR) / z };
    }

    loop(ms) {
      this.raf = null;
      const t = ms / 1000;
      // Sløjfens egen tid (som i drew.js): performance.now() kan ligge foran rAF-tidsstemplet.
      const dt = this.lastT === null ? 1 / 60 : Math.min(0.1, Math.max(0, t - this.lastT));
      this.lastT = t;
      try {
        this.update(dt);
        this.draw();
      } catch (err) {
        console.warn('Tron overlay:', err);
      }
      const target = this.enabled && !this.asleep ? 1 : 0;
      if (this.enabled || this.visibility > 0.001) {
        this.raf = requestAnimationFrame(this.frame);
      } else {
        this.canvas.hidden = true;
        this.lastT = null;
      }
      this.target = target;
    }

    update(dt) {
      const target = this.enabled && !this.asleep ? 1 : 0;
      this.visibility += (target - this.visibility) * Math.min(1, dt * 2.5);
      // Gulvet ruller én linje pr. slag mod beskueren.
      this.scroll = (this.scroll + (this.bpm / 60) * dt) % 1;
      this.pulse *= Math.exp(-dt / 0.22);
      this.derez = Math.max(0, this.derez - dt / 0.35);
      if (this.sweep !== null) {
        this.sweep += dt / 0.9;
        if (this.sweep >= 1) this.sweep = null;
      }
      for (const c of this.cycles) {
        if (c.dead) {
          c.trail = c.trail.filter((p) => (p.age += dt) < 1.6);
          continue;
        }
        for (const p of c.trail) p.age += dt;
        if (!c.turned && c.turnAt !== null && (c.x - c.turnAt) * c.dir >= 0) {
          c.turned = true;
          c.trail.push({ x: c.x, z: c.z, age: 0 });
        }
        if (c.turned) c.z -= c.speed * 0.45 * dt;
        else c.x += c.dir * c.speed * dt;
        c.trail.push({ x: c.x, z: c.z, age: 0 });
        c.trail = c.trail.filter((p) => p.age < 1.6);
        if (Math.abs(c.x) > SIDE + 2 || c.z < NEAR * 1.05) c.dead = true;
      }
      this.cycles = this.cycles.filter((c) => !c.dead || c.trail.length);
    }

    draw() {
      const { w, h } = this.resize();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, w, h);
      if (this.visibility < 0.002) return;
      ctx.save();
      ctx.globalAlpha = this.visibility;
      const horizon = h * HORIZON;
      const line = this.palette.line;
      const glow = 0.45 + 0.55 * this.pulse;
      // Mørk bund under gulvet: ellers drukner linjerne i et travlt MilkDrop-billede.
      const floor = ctx.createLinearGradient(0, horizon, 0, h);
      floor.addColorStop(0, 'rgba(0,0,0,0)');
      floor.addColorStop(0.35, 'rgba(0,0,0,0.45)');
      floor.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, horizon, w, h - horizon);
      ctx.globalCompositeOperation = 'lighter';
      // En linje med glød: bred og svag, så smal og klar (billigere end shadowBlur).
      const glowLine = (x0, y0, x1, y1, color, alpha, width) => {
        ctx.strokeStyle = rgba(color, alpha * 0.35);
        ctx.lineWidth = width * 4;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = width;
        ctx.stroke();
      };
      const unit = Math.max(1, w / 1280);

      // Horisontens glød.
      const band = ctx.createLinearGradient(0, horizon - h * 0.08, 0, horizon + h * 0.04);
      band.addColorStop(0, rgba(line, 0));
      band.addColorStop(0.7, rgba(line, 0.1 + 0.25 * this.pulse));
      band.addColorStop(1, rgba(line, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, horizon - h * 0.08, w, h * 0.12);

      // Horisonten: en skarp lyslinje.
      ctx.lineCap = 'round';
      glowLine(0, horizon, w, horizon, line, 0.55 + 0.45 * this.pulse, 1.5 * unit);
      // Tværgående linjer, der ruller mod beskueren.
      for (let i = 0; i < FAR; i++) {
        const z = FAR - i - this.scroll;
        if (z < NEAR) continue;
        const y = this.project(0, z, w, h).y;
        const near = 1 - (z - NEAR) / (FAR - NEAR); // 0 langt væk, 1 tæt på
        glowLine(0, y, w, y, line, (0.15 + 0.65 * near) * glow, Math.max(1, 2 * near * unit));
      }
      // Linjer i dybden mod forsvindingspunktet, svagest ved horisonten.
      for (let x = -SIDE; x <= SIDE; x += 1.5) {
        const mid = this.project(x, (FAR + NEAR) / 3, w, h);
        const a = this.project(x, FAR, w, h);
        const b = this.project(x, NEAR, w, h);
        glowLine(a.x, a.y, mid.x, mid.y, line, 0.18 * glow, 1.2 * unit);
        glowLine(mid.x, mid.y, b.x, b.y, line, 0.55 * glow, 1.6 * unit);
      }

      // Ny del: en lysstreg fra horisonten mod beskueren.
      if (this.sweep !== null) {
        const z = FAR - (FAR - NEAR) * this.sweep;
        const y = this.project(0, z, w, h).y;
        ctx.strokeStyle = rgba(this.palette.accent, 0.9 * (1 - this.sweep * 0.6));
        ctx.lineWidth = Math.max(2, 4 * (w / 1280));
        ctx.shadowColor = rgba(this.palette.accent, 1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Lyscyklerne og deres lysvægge.
      for (const c of this.cycles) {
        if (c.trail.length < 2) continue;
        // Lysvæggen som sammenhængende stykker (ikke enkelte prikker), der toner ud bagfra.
        ctx.lineJoin = 'round';
        const width = Math.max(2, (15 / c.z) * unit);
        for (let i = 1; i < c.trail.length; i += 4) {
          const life = 1 - c.trail[Math.min(c.trail.length - 1, i + 3)].age / 1.6;
          if (life <= 0) continue;
          const pts = c.trail.slice(i - 1, i + 4).map((p) => this.project(p.x, p.z, w, h));
          for (const [alpha, lw] of [[0.3, width * 3.5], [0.95, width]]) {
            ctx.strokeStyle = rgba(c.color, alpha * life);
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
        }
        if (!c.dead) {
          const head = this.project(c.x, c.z, w, h);
          const r = Math.max(3, (14 / c.z) * (w / 1280));
          const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r * 3);
          g.addColorStop(0, rgba([255, 255, 255], 0.95));
          g.addColorStop(0.3, rgba(c.color, 0.8));
          g.addColorStop(1, rgba(c.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(head.x, head.y, r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Derez: lyse vandrette splinter og skanlinjer et øjeblik efter et hårdt klip.
      if (this.derez > 0) {
        const n = 14;
        for (let i = 0; i < n; i++) {
          const y = Math.random() * h;
          const bh = Math.max(1, Math.random() * h * 0.025);
          const x = Math.random() * w * 0.4;
          ctx.fillStyle = rgba(Math.random() < 0.7 ? line : this.palette.accent, 0.5 * this.derez);
          ctx.fillRect(x, y, w * (0.3 + Math.random() * 0.7), bh);
        }
        ctx.fillStyle = rgba(line, 0.12 * this.derez);
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.TronOverlay = TronOverlay;
})();
