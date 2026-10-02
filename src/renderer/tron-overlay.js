/*
 * Tron-laget over MilkDrop (slås til og fra med "trongrid" i link-feltet eller Flynns terminal; starter slukket): et
 * perspektivgulv, der ruller med tempoet, lyscykler, der kører hen over gulvet på drops og ind imellem på en
 * taktstart, en lysstreg ved en ny del og et kort derez-glimt på hårde klip. Tegnes additivt ("lighter"), så MilkDrop
 * stadig er hovedsagen.
 *
 * Musikmotorens hændelser kommer ind via beat() og event(). Derudover drives laget løbende af lyden via drive(), ét
 * bånd pr. element (src/shared/band-drive.js):
 *   kick-båndet og rigtige kick-onsets → gulvets glød og horisonten (den forudsagte takt kun, når der ikke er kicks)
 *   mellemtonen                        → lyscyklernes spor: lysstyrke, bredde og fart
 *   diskanten og hi-hats               → glimt i gitterets knuder og et svagt skanlinje-flimmer på gulvet
 *   sangens del og opbygninger         → global intensitet og mætning, der stiger gennem en opbygning
 * Alt ændrer lysstyrken glat (attack og release, ingen tænd-sluk), og de store flader følger kun kicket med samme
 * henfald som før (0,22 s); test/tron-overlay.test.js tjekker, at blink-vagten ikke ville slå til på laget.
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
  // Højst 1,5 lærredspixel pr. CSS-pixel: laget er bløde, glødende linjer i 2D, og fulde 4K-pixels koster CPU uden at
  // ses. Op til 150 % Windows-skalering tegnes 1:1 i skærmpixels.
  const MAX_PIXEL_RATIO = 1.5;
  const DEPTH_STEP = 1.5; // afstanden mellem linjerne i dybden
  const GLINTS = 7; // knuder, der glimter pr. hi-hat
  const SECTION_ATTACK = 1; // sekunder: intensitet og mætning følger sangens del langsomt, så skiftet aldrig blinker
  const SECTION_RELEASE = 1.5;

  const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

  class TronOverlay {
    constructor(canvas) {
      const BD = window.VisampBandDrive;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.enabled = false;
      this.asleep = false;
      this.visibility = 0; // 0-1: toner ind og ud
      this.palette = PALETTES.grid;
      this.bpm = 120;
      this.scroll = 0; // gulvets rulning i gulv-enheder
      this.pulse = 0; // lys fra det seneste forudsagte slag (0-1), når der ikke høres rigtige kicks
      this.sweep = null; // lysstreg fra horisonten mod beskueren ved en ny del (0-1)
      this.derez = 0; // derez-glimt ved et hårdt klip (0-1)
      this.cycles = [];
      this.downbeats = 0;
      // Bånd-drevet: niveauerne (0-1) fra seneste drive(); uden lyd ser laget ud som det hændelsesdrevne.
      this.bandDrive = new BD.BandDrive();
      this.bands = this.bandDrive.out;
      this.sectionGoal = null; // mål for intensitet og mætning fra sangens del (null: fuld, som uden bånd-drev)
      this.intensity = 1;
      this.saturation = 1;
      this.glintNodes = [];
      this.scan = 0; // skanlinjernes forskydning
      this.driveBroken = false;
      this.lastT = null;
      this.raf = null;
      this.frame = (ms) => this.loop(ms);
      this.devicePixels = null; // præcise skærmpixels fra ResizeObserver (som visualizer.js)
      if (typeof ResizeObserver === 'function') this.observeSize();
    }

    observeSize() {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        const box = entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
        const css = entry.contentBoxSize && entry.contentBoxSize[0];
        this.devicePixels = box && css ? { width: box.inlineSize, height: box.blockSize, cssWidth: css.inlineSize, cssHeight: css.blockSize } : null;
      });
      try {
        observer.observe(this.canvas, { box: 'device-pixel-content-box' });
      } catch (err) {
        console.warn('Tron overlay: ResizeObserver without device-pixel-content-box; sizing from CSS pixels:', err);
        observer.observe(this.canvas);
      }
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

    /**
     * Hvert billede fra musikmotoren: lydtræk (FeatureExtractor), motorens tilstand (stilhed, energi, opbygning) og
     * kick-onset (MusicEngine.lastKickOnset). Kører også, mens laget er slukket, så gennemsnittene er varme, når det
     * tændes. En fejl stopper bånd-drevet (laget kører videre på hændelserne) og står i konsollen.
     */
    drive(t, features, state, kickOnset) {
      if (this.driveBroken) return;
      try {
        this.bands = this.bandDrive.update(t, features, { silent: Boolean(state && state.silent), kickOnset });
        this.sectionGoal = window.VisampBandDrive.sectionTarget(state, t);
        if (this.bands.hatHit && this.enabled) this.spawnGlints();
      } catch (err) {
        this.driveBroken = true;
        console.error('Tron overlay: band drive stopped:', err);
      }
    }

    /** Nyt nummer: båndene måles mod den nye sang. */
    resetDrive() {
      this.bandDrive.reset();
    }

    /** Et slag fra musikmotoren. */
    beat(e) {
      if (!this.enabled) return;
      if (e && e.bpm) this.setTempo(e.bpm);
      const down = Boolean(e && e.downbeat);
      // Høres der rigtige kicks, lyser gulvet på dem (drive); den forudsagte takt er reserven.
      if (!this.bands.realKicks) this.pulse = Math.max(this.pulse, down ? 1 : 0.55);
      if (down) {
        this.downbeats += 1;
        // En lyscykel på hver anden taktstart (før hver 8.; Peter ville have flere, 02-10-2026).
        if (this.downbeats % 2 === 0) this.spawnCycle();
      } else if (Math.random() < 0.12) {
        // ... og ind imellem en ekstra på et almindeligt slag.
        this.spawnCycle();
      }
    }

    /** 'drop' (lyscykler og fuldt lys), 'section' (lysstreg mod beskueren) eller 'cut' (derez). */
    event(type) {
      if (!this.enabled) return;
      if (type === 'drop') {
        this.pulse = 1;
        // Droppet: en flok lyscykler fra begge sider.
        for (let i = 0; i < 5; i++) this.spawnCycle(i % 2);
      } else if (type === 'section') {
        this.sweep = 0;
      } else if (type === 'cut') {
        this.derez = 1;
      }
    }

    /** En lyscykel på tværs af gulvet i en tilfældig dybde, fra venstre eller højre, i laget eller accentfarven. */
    spawnCycle(colorIndex = Math.random() < 0.6 ? 0 : 1) {
      if (this.cycles.filter((c) => !c.dead).length >= 12) return;
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
        accent: colorIndex !== 0, // farven slås op ved tegning, så temaet og mætningen følger med
        trail: [],
        dead: false,
      });
    }

    /** Et hi-hat: nogle tilfældige knuder i gitteret (hvor linjerne krydser) glimter og toner ud på 65 ms. */
    spawnGlints() {
      const nodes = [];
      for (let i = 0; i < GLINTS; i++) {
        const x = -SIDE + DEPTH_STEP * Math.floor(Math.random() * ((2 * SIDE) / DEPTH_STEP + 1));
        // De tværgående linjer ligger i heltalsdybder minus rulningen; glimtet følger med gulvet.
        const row = Math.floor(NEAR + 1 + Math.random() * (FAR - NEAR - 2));
        nodes.push({ x, row });
      }
      this.glintNodes = nodes;
    }

    start() {
      if (this.raf === null) this.raf = requestAnimationFrame(this.frame);
    }

    /**
     * Lærredets størrelse, målt hvert billede. ResizeObserverens skærmpixels bruges, når de hører til den nuværende
     * CSS-størrelse (lige efter laget er vist, har observeren endnu ikke meldt); ellers CSS-pixels x devicePixelRatio.
     */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const scale = Math.min(1, MAX_PIXEL_RATIO / ratio);
      const dp = this.devicePixels;
      const exact = dp && Math.abs(dp.cssWidth - rect.width) < 0.5 && Math.abs(dp.cssHeight - rect.height) < 0.5;
      const w = Math.max(2, Math.round((exact ? dp.width : rect.width * ratio) * scale));
      const h = Math.max(2, Math.round((exact ? dp.height : rect.height * ratio) * scale));
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

    /** Lyscyklernes spor efter mellemtonen: 0,5 (normal) = 1, rækker 0,7-1,3. */
    midGain(amount) {
      return 1 + amount * (this.bands.mid - 0.5);
    }

    /**
     * Lyset på gulvets linjer, 0-1: den største flade, der følger slagene, og det, der kunne blinke. Horisontens glød
     * (12 % af højden, højst 35 %), glimtene og skanlinjerne er for små til at flytte billedets lysstyrke mærkbart.
     * Blink-vagten måler kun MilkDrops billede, så testen fodrer den med dette tal for at se, at laget holder sig
     * under dens grænse.
     */
    floorLight() {
      return this.visibility * Math.min(1, this.intensity) * (0.45 + 0.55 * Math.max(this.pulse, this.bands.kick));
    }

    update(dt) {
      const target = this.enabled && !this.asleep ? 1 : 0;
      this.visibility += (target - this.visibility) * Math.min(1, dt * 2.5);
      // Gulvet ruller én linje pr. slag mod beskueren.
      this.scroll = (this.scroll + (this.bpm / 60) * dt) % 1;
      this.scan = (this.scan + dt * 23) % 1;
      this.pulse *= Math.exp(-dt / 0.22);
      this.derez = Math.max(0, this.derez - dt / 0.35);
      if (this.sweep !== null) {
        this.sweep += dt / 0.9;
        if (this.sweep >= 1) this.sweep = null;
      }
      // Sangens del: intensitet og mætning glider mod målet (sekunder, så det aldrig blinker).
      const goal = this.sectionGoal || { intensity: 1, saturation: 1 };
      for (const key of ['intensity', 'saturation']) {
        const tau = goal[key] > this[key] ? SECTION_ATTACK : SECTION_RELEASE;
        this[key] += (goal[key] - this[key]) * (1 - Math.exp(-dt / tau));
      }
      const speedGain = this.midGain(0.5);
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
        if (c.turned) c.z -= c.speed * speedGain * 0.45 * dt;
        else c.x += c.dir * c.speed * speedGain * dt;
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
      const BD = window.VisampBandDrive;
      const bands = this.bands;
      const I = this.intensity; // over 1 i toppen af en opbygning: linjerne lyser kraftigere
      ctx.save();
      ctx.globalAlpha = this.visibility;
      const horizon = h * HORIZON;
      const line = BD.saturate(this.palette.line, this.saturation);
      const accent = BD.saturate(this.palette.accent, this.saturation);
      const glow = 0.45 + 0.55 * Math.max(this.pulse, bands.kick);
      const horizonLight = Math.max(this.pulse, bands.horizon);
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
        ctx.strokeStyle = rgba(color, alpha * I * 0.35);
        ctx.lineWidth = width * 4;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.strokeStyle = rgba(color, alpha * I);
        ctx.lineWidth = width;
        ctx.stroke();
      };
      const unit = Math.max(1, w / 1280);

      // Horisontens glød (rigtige kicks, ellers den forudsagte takt).
      const band = ctx.createLinearGradient(0, horizon - h * 0.08, 0, horizon + h * 0.04);
      band.addColorStop(0, rgba(line, 0));
      band.addColorStop(0.7, rgba(line, (0.1 + 0.25 * horizonLight) * Math.min(1, I)));
      band.addColorStop(1, rgba(line, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, horizon - h * 0.08, w, h * 0.12);

      // Horisonten: en skarp lyslinje.
      ctx.lineCap = 'round';
      glowLine(0, horizon, w, horizon, line, 0.55 + 0.45 * horizonLight, 1.5 * unit);
      // Tværgående linjer, der ruller mod beskueren; gløden følger kick-båndet.
      for (let i = 0; i < FAR; i++) {
        const z = FAR - i - this.scroll;
        if (z < NEAR) continue;
        const y = this.project(0, z, w, h).y;
        const near = 1 - (z - NEAR) / (FAR - NEAR); // 0 langt væk, 1 tæt på
        glowLine(0, y, w, y, line, (0.15 + 0.65 * near) * glow, Math.max(1, 2 * near * unit));
      }
      // Linjer i dybden mod forsvindingspunktet, svagest ved horisonten.
      for (let x = -SIDE; x <= SIDE; x += DEPTH_STEP) {
        const mid = this.project(x, (FAR + NEAR) / 3, w, h);
        const a = this.project(x, FAR, w, h);
        const b = this.project(x, NEAR, w, h);
        glowLine(a.x, a.y, mid.x, mid.y, line, 0.18 * glow, 1.2 * unit);
        glowLine(mid.x, mid.y, b.x, b.y, line, 0.55 * glow, 1.6 * unit);
      }

      // Diskanten: et svagt skanlinje-flimmer på gulvet (højst 6 % lys, tynde linjer).
      if (bands.treb > 0.02) {
        const spacing = 4 * unit;
        const rows = Math.floor((h - horizon) / spacing);
        const offset = this.scan * spacing;
        for (let r = 0; r < rows; r++) {
          const y = horizon + offset + r * spacing;
          const flicker = 0.6 + 0.4 * Math.sin(r * 1.7 + this.scan * Math.PI * 2);
          ctx.fillStyle = rgba(line, 0.06 * bands.treb * flicker * Math.min(1, I));
          ctx.fillRect(0, y, w, Math.max(1, unit * 0.75));
        }
      }

      // Hi-hats: glimt i knuderne, hvor gitterets linjer krydser (små prikker, toner ud på 65 ms).
      if (bands.glint > 0.02) {
        for (const node of this.glintNodes) {
          const z = node.row - this.scroll;
          if (z < NEAR || z > FAR) continue;
          const p = this.project(node.x, z, w, h);
          const r = Math.max(2, (10 / z) * unit);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5);
          g.addColorStop(0, rgba([255, 255, 255], 0.9 * bands.glint * Math.min(1, I)));
          g.addColorStop(0.35, rgba(line, 0.7 * bands.glint * Math.min(1, I)));
          g.addColorStop(1, rgba(line, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Ny del: en lysstreg fra horisonten mod beskueren.
      if (this.sweep !== null) {
        const z = FAR - (FAR - NEAR) * this.sweep;
        const y = this.project(0, z, w, h).y;
        ctx.strokeStyle = rgba(accent, 0.9 * (1 - this.sweep * 0.6));
        ctx.lineWidth = Math.max(2, 4 * (w / 1280));
        ctx.shadowColor = rgba(accent, 1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Lyscyklerne og deres lysvægge; mellemtonen giver sporene lysstyrke og bredde.
      const trailAlpha = this.midGain(0.6) * I;
      const trailWidth = this.midGain(0.6);
      for (const c of this.cycles) {
        if (c.trail.length < 2) continue;
        const color = c.accent ? accent : line;
        // Lysvæggen som sammenhængende stykker (ikke enkelte prikker), der toner ud bagfra.
        ctx.lineJoin = 'round';
        const width = Math.max(2, (15 / c.z) * unit * trailWidth);
        for (let i = 1; i < c.trail.length; i += 4) {
          const life = 1 - c.trail[Math.min(c.trail.length - 1, i + 3)].age / 1.6;
          if (life <= 0) continue;
          const pts = c.trail.slice(i - 1, i + 4).map((p) => this.project(p.x, p.z, w, h));
          for (const [alpha, lw] of [[0.3, width * 3.5], [0.95, width]]) {
            ctx.strokeStyle = rgba(color, alpha * life * trailAlpha);
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
          g.addColorStop(0.3, rgba(color, 0.8));
          g.addColorStop(1, rgba(color, 0));
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
          ctx.fillStyle = rgba(Math.random() < 0.7 ? line : accent, 0.5 * this.derez);
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
