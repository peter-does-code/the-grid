/*
 * Introen, som i Tron:
 *   1. Kampen: op til 12 lyscykler, to hold, rezzer ind fra hver sin side af the Grid. Kameraet ser
 *      skråt ned, så lysvæggene står op fra gulvet. Cyklerne skærer hinanden af, undgår fælder og
 *      derezzer i splinter, når de rammer en væg.
 *   2. Til sidst er der én tilbage på hvert hold. Væggene synker i gulvet, og kameraet drejer ned,
 *      så det ser lige ned på the Grid.
 *   3. Duellen: taberen kører første linje ("WELCOME"), vinderen kører starten af anden linje
 *      ("TO THE") med deres lysvægge. Taberen suser ned under teksten, vinderen skærer den af, og
 *      taberen derezzer mod vinderens væg. Vinderen kører det sidste ord ("GRID") og forlader skærmen.
 * Med en tom liste af linjer (Konami-koden) er der kun kamp, til én er tilbage.
 * Påskeægget "flynn" bruger samme koreografi med linjerne "FLYNN" og "LIVES".
 */
(function () {
  'use strict';

  const Font = window.GridFont;
  const TAU = Math.PI * 2;
  const DIRS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];

  // sides[0] er vinderens hold (Tron-cyan), sides[1] taberens (Clu-orange). I Clu-temaet vinder Clu.
  const PALETTES = {
    grid: { floor: '0, 229, 255', sides: ['#00e5ff', '#ff8a1e'], names: ['blue', 'orange'], core: '#effeff', border: '#8ff6ff' },
    clu: { floor: '255, 138, 30', sides: ['#ff8a1e', '#00e5ff'], names: ['orange', 'blue'], core: '#fff4e8', border: '#ffc88f' },
    classic: { floor: '61, 255, 61', sides: ['#3dff3d', '#e2b347'], names: ['green', 'gold'], core: '#f4fff4', border: '#b6ffb6' },
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, f) => a + (b - a) * f;
  const ease = (f) => {
    const x = clamp(f, 0, 1);
    return x * x * (3 - 2 * x);
  };

  /** Bygger en bane af vandrette og lodrette stykker. Hvert stykke er 'text' (bliver stående) eller 'link'. */
  class PathBuilder {
    constructor(start) {
      this.cur = start.slice();
      this.segs = [];
      this.length = 0;
      this.marks = {};
    }

    to(p, kind = 'link', meta = null) {
      const [x0, y0] = this.cur;
      const [x1, y1] = p;
      // Kun rette vinkler: et skråt stykke deles i et vandret og et lodret.
      if (Math.abs(x1 - x0) > 0.01 && Math.abs(y1 - y0) > 0.01) {
        this.to([x1, y0], kind, meta);
        this.to([x1, y1], kind, meta);
        return this;
      }
      const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      if (len < 0.01) return this;
      this.segs.push({ a: [x0, y0], b: [x1, y1], kind, meta, s0: this.length, s1: this.length + len });
      this.length += len;
      this.cur = [x1, y1];
      return this;
    }

    /** Lodret til en kørebane, vandret hen under/over målet, og lodret ind på det. */
    route(target, laneY, kind = 'link') {
      this.to([this.cur[0], laneY], kind);
      this.to([target[0], laneY], kind);
      return this.to(target, kind);
    }

    stroke(points, meta) {
      for (let i = 1; i < points.length; i++) this.to(points[i], 'text', meta);
      return this;
    }

    mark(name) {
      this.marks[name] = this.length;
      return this;
    }
  }

  class GridIntro {
    /**
     * @param {HTMLElement} root overlay-elementet (skjules, når introen er færdig)
     * @param {HTMLCanvasElement} canvas
     * @param {object} opts
     *   lines          [linje 1, linje 2]. Taberen kører linje 1, vinderen resten; tom liste = kun kamp
     *   theme          'grid' | 'clu' | 'classic'
     *   battleSeconds  hvor længe der kæmpes
     *   cycles         antal lyscykler (fordeles på to hold)
     *   onDone
     */
    constructor(root, canvas, opts = {}) {
      this.root = root;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.lines = opts.lines === undefined ? ['WELCOME', 'TO THE GRID'] : opts.lines.map((l) => l.toUpperCase());
      this.palette = PALETTES[opts.theme] || PALETTES.grid;
      this.battleOnly = this.lines.length === 0;
      this.battleEnd = opts.battleSeconds || (this.battleOnly ? 14 : 4.8);
      this.cycleCount = opts.cycles || 16;
      this.onDone = opts.onDone || (() => {});
      this.random = opts.random || Math.random;
      this.running = false;
      this.particles = [];
      this.rings = [];
      this.shakeUntil = 0;
      this.shakeStrength = 0;
      this.flashUntil = 0;
      this.flashColor = '#ffffff';
      // Tidspunkter, der kendes, når duellen er planlagt (bruges også af selvtesten).
      this.crashAt = undefined;
      this.textDone = undefined;
      this.endAt = undefined;
      this.onKey = (event) => {
        if (event && event.stopPropagation) {
          event.stopPropagation();
          event.preventDefault();
        }
        this.finish(true);
      };
    }

    start() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.W = Math.round(window.innerWidth * dpr);
      this.H = Math.round(window.innerHeight * dpr);
      this.canvas.width = this.W;
      this.canvas.height = this.H;
      this.cell = Math.max(8 * dpr, Math.round(Math.min(this.W, this.H) / 50));
      this.cols = Math.floor(this.W / this.cell);
      this.rows = Math.floor(this.H / this.cell);
      this.ox = (this.W - this.cols * this.cell) / 2;
      this.oy = (this.H - this.rows * this.cell) / 2;
      this.occupied = new Int16Array(this.cols * this.rows);
      this.visited = new Int32Array(this.cols * this.rows);
      this.visitStamp = 0;
      this.queue = new Int32Array(this.cols * this.rows);
      this.D = Math.max(this.W, this.H) * 1.35; // kameraets afstand; mindre = kraftigere perspektiv
      this.selectAt = this.battleOnly ? Infinity : Math.max(1.2, this.battleEnd - 1.3);
      this.setupBattle();

      this.root.classList.remove('fading');
      this.root.hidden = false;
      window.addEventListener('keydown', this.onKey, true);
      this.root.addEventListener('mousedown', this.onKey);
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

    // ---------- Kampen ----------

    setupBattle() {
      this.cycles = [];
      const perTeam = Math.ceil(this.cycleCount / 2);
      for (let i = 0; i < this.cycleCount; i++) {
        const team = i % 2;
        const slot = Math.floor(i / 2);
        // Holdene står i række på hver sin side, forskudt en halv plads, som på Game Grid.
        const frac = (slot + 1 + (team ? 0.5 : 0)) / (perTeam + 1.5);
        const y = clamp(Math.round(this.rows * frac), 2, this.rows - 3);
        const x = team ? this.cols - 3 : 2;
        const cycle = {
          id: i + 1,
          team,
          color: this.palette.sides[team],
          x,
          y,
          dir: team ? 2 : 0,
          progress: 0,
          speed: 18 + this.random() * 4, // celler pr. sekund
          trail: [[x, y]],
          alive: true,
          deadAt: null,
          delay: 0.55 + slot * 0.09 + this.random() * 0.1,
          doomed: false,
          finalist: false,
        };
        this.mark(cycle.x, cycle.y, cycle.id);
        this.cycles.push(cycle);
      }
    }

    index(x, y) {
      return y * this.cols + x;
    }

    free(x, y) {
      return x >= 0 && y >= 0 && x < this.cols && y < this.rows && this.occupied[this.index(x, y)] === 0;
    }

    mark(x, y, id) {
      if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) this.occupied[this.index(x, y)] = id;
    }

    runLength(x, y, dir, max = 12) {
      const [dx, dy] = DIRS[dir];
      let n = 0;
      while (n < max && this.free(x + dx * (n + 1), y + dy * (n + 1))) n += 1;
      return n;
    }

    /** Hvor mange frie felter kan nås herfra (op til `limit`)? Små tal betyder en fælde. */
    space(x, y, limit = 140) {
      if (!this.free(x, y)) return 0;
      const stamp = ++this.visitStamp;
      const { cols, rows, visited, queue, occupied } = this;
      let head = 0;
      let tail = 0;
      queue[tail++] = this.index(x, y);
      visited[queue[0]] = stamp;
      while (head < tail && tail < limit) {
        const i = queue[head++];
        const cx = i % cols;
        const cy = (i - cx) / cols;
        if (cx > 0 && visited[i - 1] !== stamp && occupied[i - 1] === 0) (visited[i - 1] = stamp), (queue[tail++] = i - 1);
        if (cx < cols - 1 && visited[i + 1] !== stamp && occupied[i + 1] === 0) (visited[i + 1] = stamp), (queue[tail++] = i + 1);
        if (cy > 0 && visited[i - cols] !== stamp && occupied[i - cols] === 0) (visited[i - cols] = stamp), (queue[tail++] = i - cols);
        if (cy < rows - 1 && visited[i + cols] !== stamp && occupied[i + cols] === 0) (visited[i + cols] = stamp), (queue[tail++] = i + cols);
      }
      return Math.min(tail, limit);
    }

    nearestEnemy(cycle, maxDist = 34) {
      let best = null;
      let bestDist = maxDist;
      for (const c of this.cycles) {
        if (!c.alive || c.team === cycle.team || !c.started) continue;
        const d = Math.abs(c.x - cycle.x) + Math.abs(c.y - cycle.y);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best && { enemy: best, dist: bestDist };
    }

    /**
     * Vælg retning som en rigtig spiller: bliv i live (fri plads, ingen fælder), kør gerne lige ud,
     * og skær modstanderen af ved at sigte efter det sted, den er på vej hen.
     */
    chooseDir(cycle) {
      const options = [cycle.dir, (cycle.dir + 1) % 4, (cycle.dir + 3) % 4];
      const target = this.nearestEnemy(cycle);
      let best = null;
      let bestScore = -Infinity;
      for (const dir of options) {
        const [dx, dy] = DIRS[dir];
        const nx = cycle.x + dx;
        const ny = cycle.y + dy;
        if (!this.free(nx, ny)) continue;
        const room = this.space(nx, ny);
        let score;
        if (cycle.doomed) {
          score = -room + this.random() * 20; // taberne i finalen: kør mod den nærmeste væg
        } else {
          score = (room / 140) * 10 + Math.min(this.runLength(cycle.x, cycle.y, dir), 10) * 0.35 + this.random() * 1.4;
          if (room < 25) score -= 8; // en blindgyde
          else if (room < 70) score -= 3; // en smal korridor mellem holdkammeraternes vægge lukker hurtigt
          if (dir === cycle.dir) score += 1.6;
          if (target && room > 40) {
            const { enemy, dist } = target;
            // Forudsig, hvor modstanderen er om lidt, og kør derhen for at lægge en væg foran den.
            const [ex, ey] = DIRS[enemy.dir];
            const ahead = Math.min(10, Math.round(dist * 0.6) + 2);
            const px = enemy.x + ex * ahead;
            const py = enemy.y + ey * ahead;
            const before = Math.abs(px - cycle.x) + Math.abs(py - cycle.y);
            const after = Math.abs(px - nx) + Math.abs(py - ny);
            if (after < before) score += 3.4;
            // Kør på tværs af modstanderens bane, når vi er foran den: det er afskæringen.
            const perpendicular = dx * ex + dy * ey === 0;
            const inFront = (cycle.x - enemy.x) * ex + (cycle.y - enemy.y) * ey > 0;
            if (perpendicular && inFront && dist < 16) score += 3.2;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = dir;
        }
      }
      return best;
    }

    /** Må cyklen ikke dø lige nu? Før finalen redder vi den sidste på hvert hold; i finalen de to finalister. */
    protectedCycle(cycle, t) {
      if (this.battleOnly) return false;
      if (t >= this.selectAt) return cycle.finalist;
      return this.cycles.filter((c) => c.alive && c.team === cycle.team).length <= 1;
    }

    selectFinalists() {
      for (const team of [0, 1]) {
        const alive = this.cycles.filter((c) => c.alive && c.team === team);
        let best = null;
        let bestRoom = -1;
        for (const c of alive) {
          const room = this.space(c.x + DIRS[c.dir][0], c.y + DIRS[c.dir][1], 400);
          if (room > bestRoom) {
            bestRoom = room;
            best = c;
          }
        }
        if (best) best.finalist = true;
      }
      for (const c of this.cycles) if (c.alive && !c.finalist) c.doomed = true;
    }

    updateBattle(t, dt) {
      if (t > this.battleEnd) return;
      if (t >= this.selectAt && !this.selected) {
        this.selected = true;
        this.selectFinalists();
      }
      for (const cycle of this.cycles) {
        if (!cycle.alive || t < cycle.delay) continue;
        cycle.started = true;
        cycle.progress += cycle.speed * dt;
        while (cycle.progress >= 1 && cycle.alive) {
          cycle.progress -= 1;
          let [dx, dy] = DIRS[cycle.dir];
          if (!this.free(cycle.x + dx, cycle.y + dy)) {
            const escape = this.protectedCycle(cycle, t) ? this.chooseDir({ ...cycle, doomed: false }) : null;
            if (escape === null) {
              this.derez(cycle, t);
              break;
            }
            cycle.trail.push([cycle.x, cycle.y]);
            cycle.dir = escape;
            [dx, dy] = DIRS[cycle.dir];
          }
          cycle.x += dx;
          cycle.y += dy;
          this.mark(cycle.x, cycle.y, cycle.id);
          this.grind(cycle, dx, dy);
          const dir = this.chooseDir(cycle);
          if (dir !== null && dir !== cycle.dir) {
            cycle.trail.push([cycle.x, cycle.y]);
            cycle.dir = dir;
          }
        }
      }
      // Væggene fra derezzede cykler forsvinder, så de andre kan køre der igen.
      for (const cycle of this.cycles) {
        if (!cycle.alive && !cycle.cleared && t - cycle.deadAt > 0.8) {
          cycle.cleared = true;
          for (let i = 0; i < this.occupied.length; i++) if (this.occupied[i] === cycle.id) this.occupied[i] = 0;
        }
      }
      // Kun kamp (Konami): slut kort efter, at der er én tilbage.
      if (this.battleOnly && !this.battleOverAt && t > 2 && this.cycles.filter((c) => c.alive).length <= 1) {
        this.battleOverAt = t;
        this.endAt = t + 1.8;
        this.battleEnd = t + 1.2;
      }
    }

    /** Kører cyklen tæt langs en andens væg, slår den gnister. */
    grind(cycle, dx, dy) {
      for (const side of [-1, 1]) {
        const nx = cycle.x - dy * side;
        const ny = cycle.y + dx * side;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const owner = this.occupied[this.index(nx, ny)];
        if (owner === 0 || owner === cycle.id) continue;
        const [wx, wy] = this.cellToWorld(cycle.x, cycle.y);
        for (let i = 0; i < 3; i++) {
          this.particles.push({
            x: wx - dy * side * this.cell * 0.5,
            y: wy + dx * side * this.cell * 0.5,
            h: this.cell * 0.3,
            vx: (-dx * (150 + this.random() * 250) + (this.random() - 0.5) * 120) * this.dpr,
            vy: (-dy * (150 + this.random() * 250) + (this.random() - 0.5) * 120) * this.dpr,
            vh: (100 + this.random() * 260) * this.dpr,
            life: 0.25 + this.random() * 0.3,
            age: 0,
            color: this.random() < 0.6 ? '#fff6d8' : cycle.color,
            size: (1.2 + this.random() * 1.6) * this.dpr,
          });
        }
      }
    }

    cellToWorld(x, y) {
      return [this.ox + (x + 0.5) * this.cell, this.oy + (y + 0.5) * this.cell];
    }

    headCell(cycle) {
      const [dx, dy] = DIRS[cycle.dir];
      const p = cycle.alive ? Math.min(1, cycle.progress) : 0;
      return [cycle.x + dx * p, cycle.y + dy * p];
    }

    headWorld(cycle) {
      const [x, y] = this.headCell(cycle);
      return this.cellToWorld(x, y);
    }

    derez(cycle, t) {
      cycle.alive = false;
      cycle.deadAt = t;
      const [px, py] = this.headWorld(cycle);
      this.explode(px, py, cycle.color, t);
      // Lysvæggen går i stykker: splinter langs hele væggen.
      const pts = cycle.trail.map(([x, y]) => this.cellToWorld(x, y)).concat([[px, py]]);
      this.shatter(pts, cycle.color, 0.5);
    }

    explode(x, y, color, t, strength = 1) {
      for (let i = 0; i < 46 * strength; i++) {
        const angle = this.random() * TAU;
        const speed = (80 + this.random() * 420) * this.dpr * strength;
        this.particles.push({
          x,
          y,
          h: this.cell * (0.2 + this.random() * 0.6),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          vh: (120 + this.random() * 380) * this.dpr * strength,
          life: 0.6 + this.random() * 0.9,
          age: 0,
          color: this.random() < 0.25 ? this.palette.core : color,
          size: (2 + this.random() * 3.5) * this.dpr,
        });
      }
      this.rings.push({ x, y, t, color, strength });
      this.flashUntil = t + 0.12 * strength;
      this.flashColor = color;
      this.shakeStrength = Math.max(t < this.shakeUntil ? this.shakeStrength : 0, 7 * strength);
      this.shakeUntil = t + 0.3;
    }

    shatter(points, color, density) {
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
        const n = Math.ceil((len / this.cell) * density);
        for (let k = 0; k < n; k++) {
          const f = this.random();
          this.particles.push({
            x: lerp(x0, x1, f),
            y: lerp(y0, y1, f),
            h: this.random() * this.cell * 0.9,
            vx: (this.random() - 0.5) * 90 * this.dpr,
            vy: (this.random() - 0.5) * 90 * this.dpr,
            vh: (40 + this.random() * 160) * this.dpr,
            life: 0.4 + this.random() * 0.7,
            age: 0,
            color,
            size: (1.5 + this.random() * 2.5) * this.dpr,
          });
        }
      }
    }

    // ---------- Duellen ----------

    /** Kører, når kampen slutter: planlægger de to finalisters baner og tidspunkterne. */
    setupDuel(t) {
      this.duelStart = t;
      for (const c of this.cycles) if (c.alive && !c.finalist) this.derez(c, t);
      const pick = (team) => this.cycles.find((c) => c.alive && c.finalist && c.team === team) || this.cycles.find((c) => c.alive && c.team === team);
      const starts = [0, 1].map((team) => {
        const c = pick(team);
        if (c) {
          c.handedOver = true;
          return { pos: this.headWorld(c), dir: DIRS[c.dir] };
        }
        // Holdet blev udslettet: en ny cykel rezzer ind fra kanten.
        const edgeX = team ? this.W + this.cell * 2 : -this.cell * 2;
        return { pos: [edgeX, this.H * (team ? 0.8 : 0.2)], dir: team ? [-1, 0] : [1, 0], rez: true };
      });

      const [line1, line2 = ''] = this.lines;
      const layout = Font.layout([line1, line2]);
      const u = Math.min((this.W * 0.8) / layout.width, (this.H * 0.42) / layout.height);
      this.unit = u;
      const X = (x) => this.W / 2 + x * u;
      const Y = (y) => this.H / 2 + y * u;
      const toWorld = (pts) => pts.map(([x, y]) => [X(x), Y(y)]);
      const top1 = -layout.height / 2;
      const bottom2 = layout.height / 2;
      const mid2 = bottom2 - Font.HEIGHT / 2;
      const laneLoser = Y(top1 - 1.5); // over linje 1
      const laneWinner = Y(bottom2 + 1.4); // under linje 2
      const crashY = Y(bottom2 + 3.3);
      const afterY = Y(bottom2 + 5);

      // Hvilket ord hører hver streg til?
      const words2 = line2.split(' ').filter(Boolean);
      const finalWord = words2.length ? words2.length - 1 : -1;
      const letterWord = [];
      let letter = 0;
      for (const [lineNo, line] of [line1, line2].entries()) {
        line.split(' ').filter(Boolean).forEach((word, w) => {
          for (let i = 0; i < word.length; i++) letterWord[letter++] = { line: lineNo, word: w };
        });
      }
      const strokes = layout.strokes.map((s) => ({ ...s, pts: toWorld(s.points), ...letterWord[s.letter] }));
      const loserStrokes = strokes.filter((s) => s.line === 0);
      const winnerPrefix = strokes.filter((s) => s.line === 1 && s.word !== finalWord);
      const winnerFinal = strokes.filter((s) => s.line === 1 && s.word === finalWord);

      /** Første stykke må ikke vende 180 grader i forhold til cyklens retning. */
      const begin = (start, laneY) => {
        const b = new PathBuilder(start.pos);
        const [dx, dy] = start.dir;
        const goingDown = laneY > start.pos[1];
        if (dy !== 0 && (dy > 0) !== goingDown) b.to([start.pos[0] + (start.pos[0] < this.W / 2 ? 2 : -2) * this.cell, start.pos[1]]);
        else if (dx !== 0) b.to([start.pos[0] + dx * this.cell, start.pos[1]]);
        return b;
      };

      // Taberen: linje 1, så ud til højre, ned under teksten og mod venstre, lige ind i vinderens væg.
      const loser = begin(starts[1], laneLoser);
      loserStrokes.forEach((s, i) => {
        loser.route(s.pts[0], laneLoser);
        loser.stroke(s.pts, { final: false, i });
      });
      const rightX = X(layout.width / 2 + 2.5);

      // Vinderen: starten af linje 2, så lodret ned gennem taberens bane (afskæringen), og det sidste ord.
      const winner = begin(starts[0], laneWinner);
      winnerPrefix.forEach((s) => {
        winner.route(s.pts[0], laneWinner);
        winner.stroke(s.pts, { final: false });
      });
      const firstFinal = winnerFinal[0];
      if (!winnerPrefix.length) {
        // Intet før det sidste ord (fx "FLYNN / LIVES"): vinderen kommer ind til venstre for ordet.
        const left = firstFinal ? Math.min(...winnerFinal.flatMap((s) => s.pts.map((p) => p[0]))) : this.W / 2;
        winner.route([left - 2 * u, Y(mid2)], laneWinner);
      }
      const cutX = winner.cur[0];
      winner.to([cutX, crashY]).mark('cross').to([cutX, afterY]);
      if (firstFinal) {
        winner.to([firstFinal.pts[0][0], afterY]).to(firstFinal.pts[0]);
        winnerFinal.forEach((s, i) => {
          if (i) winner.route(s.pts[0], laneWinner);
          winner.stroke(s.pts, { final: true });
        });
      }
      winner.mark('textDone');
      winner.to([winner.cur[0], laneWinner]).to([this.W + this.cell * 6, laneWinner]); // ud af skærmen

      loser.to([Math.max(rightX, loser.cur[0] + u), loser.cur[1]]).to([Math.max(rightX, loser.cur[0]), crashY]);
      loser.to([cutX + 0.45 * u, crashY]);

      // Fart: vinderen kører fast; taberens fart vælges, så den rammer væggen lige efter, at den er lagt.
      const vW = 60 * u;
      const tCross = winner.marks.cross / vW;
      const vL = clamp(loser.length / (tCross + 0.32), vW * 0.7, vW * 2.4);
      this.riders = [
        { path: winner, v: vW, color: this.palette.sides[0], rez: starts[0].rez, winner: true },
        { path: loser, v: vL, color: this.palette.sides[1], rez: starts[1].rez, winner: false },
      ];
      this.crashAt = t + loser.length / vL;
      this.textDone = t + winner.marks.textDone / vW;
      this.endAt = this.textDone + 1.9;
    }

    /** Hvor er rytteren på tidspunkt t? */
    riderAt(rider, t) {
      const s = clamp((t - this.duelStart) * rider.v, 0, rider.path.length);
      const segs = rider.path.segs;
      let seg = segs[segs.length - 1];
      for (const candidate of segs) {
        if (s <= candidate.s1) {
          seg = candidate;
          break;
        }
      }
      const f = seg ? clamp((s - seg.s0) / (seg.s1 - seg.s0), 0, 1) : 0;
      const pos = seg ? [lerp(seg.a[0], seg.b[0], f), lerp(seg.a[1], seg.b[1], f)] : rider.path.cur;
      const dir = seg ? [Math.sign(seg.b[0] - seg.a[0]), Math.sign(seg.b[1] - seg.a[1])] : [1, 0];
      return { s, pos, dir, done: s >= rider.path.length };
    }

    updateDuel(t) {
      if (!this.riders) return;
      const loser = this.riders[1];
      if (!loser.dead && t >= this.crashAt) {
        loser.dead = true;
        loser.deadAt = t;
        const { pos } = this.riderAt(loser, t);
        this.explode(pos[0], pos[1], loser.color, t, 1.4);
        // Taberens forbindelsesvægge derezzer; bogstaverne bliver stående.
        for (const seg of loser.path.segs) if (seg.kind === 'link') this.shatter([seg.a, seg.b], loser.color, 0.8);
        this.shakeUntil = t + 0.45;
        this.shakeStrength = 16;
      }
    }

    // ---------- Kamera ----------

    /** Skråt kamera under kampen, drejer ned til lodret over the Grid, når duellen begynder. */
    camera(t) {
      // Åbning: lavt og tæt på holdene, der rezzer ind; derefter svinger kameraet rundt over arenaen.
      const settle = ease(t / 2.4);
      let tilt = lerp(1.18, 0.95, settle);
      let yaw = lerp(-0.42, 0.22, ease(t / Math.max(3, this.battleEnd))) + 0.04 * Math.sin(t * 0.9);
      let zoom = lerp(1.55, 1.18, settle);
      let lift = this.H * lerp(0.2, 0.1, settle);
      // Følg kampen: sigt efter midten af de cykler, der stadig kører.
      const alive = this.cycles.filter((c) => c.alive && t >= c.delay);
      let fx = this.W / 2;
      let fy = this.H / 2;
      if (alive.length) {
        fx = lerp(fx, alive.reduce((sum, c) => sum + this.headWorld(c)[0], 0) / alive.length, 0.6);
        fy = lerp(fy, alive.reduce((sum, c) => sum + this.headWorld(c)[1], 0) / alive.length, 0.6);
      }
      if (!this.focus) this.focus = [fx, fy];
      const k = 1 - Math.exp(-(t - (this.lastCamT || 0)) * 2.2);
      this.lastCamT = t;
      this.focus = [lerp(this.focus[0], fx, k), lerp(this.focus[1], fy, k)];
      let [cx, cy] = this.focus;
      if (this.duelStart !== undefined) {
        const b = ease((t - this.duelStart) / 1.7);
        tilt = lerp(tilt, 0, b);
        yaw = lerp(yaw, 0, b);
        zoom = lerp(zoom, 1, b);
        lift = lerp(lift, 0, b);
        cx = lerp(cx, this.W / 2, b);
        cy = lerp(cy, this.H / 2, b);
      }
      let sx = 0;
      let sy = 0;
      if (t < this.shakeUntil) {
        const amount = this.shakeStrength * this.dpr * ((this.shakeUntil - t) / 0.45);
        sx = (this.random() - 0.5) * 2 * amount;
        sy = (this.random() - 0.5) * 2 * amount;
      }
      return { sinT: Math.sin(tilt), cosT: Math.cos(tilt), sinY: Math.sin(yaw), cosY: Math.cos(yaw), zoom, lift, sx, sy, cx, cy };
    }

    /** Punkt på gulvet (x, y) i højden h, set gennem kameraet. Returnerer [skærm-x, skærm-y, skala]. */
    project(cam, x, y, h = 0) {
      const px = x - cam.cx;
      const py = y - cam.cy;
      const xr = px * cam.cosY - py * cam.sinY;
      const yr = px * cam.sinY + py * cam.cosY;
      const depth = this.D - yr * cam.sinT - h * cam.cosT;
      const s = (this.D / Math.max(depth, this.D * 0.2)) * cam.zoom;
      return [this.W / 2 + xr * s + cam.sx, this.H / 2 + cam.lift + (yr * cam.cosT - h * cam.sinT) * s + cam.sy, s];
    }

    // ---------- Tegning ----------

    frame(t, dt) {
      this.updateBattle(t, dt);
      if (!this.battleOnly && this.duelStart === undefined && t >= this.battleEnd) this.setupDuel(t);
      this.updateDuel(t);
      const cam = this.camera(t);
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#010306';
      ctx.fillRect(0, 0, this.W, this.H);
      this.drawFloor(ctx, cam, t);

      ctx.globalCompositeOperation = 'lighter';
      this.drawBattle(ctx, cam, t);
      this.drawDuel(ctx, cam, t);
      this.drawParticles(ctx, cam, dt);
      this.drawRings(ctx, cam, t);
      if (t < this.flashUntil) {
        ctx.globalAlpha = clamp((this.flashUntil - t) / 0.12, 0, 1) * 0.18;
        ctx.fillStyle = this.flashColor;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.globalAlpha = 1;
      }

      if (this.endAt !== undefined && t > this.endAt) this.finish(false);
    }

    drawFloor(ctx, cam, t) {
      const x0 = this.ox;
      const y0 = this.oy;
      const x1 = this.ox + this.cols * this.cell;
      const y1 = this.oy + this.rows * this.cell;
      const corners = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].map(([x, y]) => this.project(cam, x, y));
      // Gulvet og en svag glød fra det nærmeste hjørne.
      const glow = ctx.createLinearGradient(0, corners[0][1], 0, corners[2][1]);
      glow.addColorStop(0, `rgba(${this.palette.floor}, 0.015)`);
      glow.addColorStop(1, `rgba(${this.palette.floor}, 0.07)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();

      // Gitteret. Linjer forbliver lige i perspektiv, så kun endepunkterne projiceres.
      const step = this.cell * 2;
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.strokeStyle = `rgba(${this.palette.floor}, 0.11)`;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 0.5; x += step) {
        const a = this.project(cam, x, y0);
        const b = this.project(cam, x, y1);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      for (let y = y0; y <= y1 + 0.5; y += step) {
        const a = this.project(cam, x0, y);
        const b = this.project(cam, x1, y);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();

      // Arenaens kant: en lav, hvid lysvæg, der synker, når kameraet ser lige ned.
      const border = this.duelStart === undefined ? 1 : 1 - ease((t - this.duelStart) / 1.2);
      if (border > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const ring = [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ];
        this.drawWall(ctx, cam, ring, this.cell * 1.4 * border, this.palette.border, 0.35 * border, 0.8);
        ctx.globalCompositeOperation = 'source-over';
      }

      // Vignet.
      const v = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.3, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
      v.addColorStop(0, 'rgba(0, 0, 0, 0)');
      v.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    /** En lysvæg langs en polylinje på gulvet: svag flade, lysende overkant, og en glød. */
    drawWall(ctx, cam, pts, height, color, alpha, weight = 1) {
      if (pts.length < 2 || alpha <= 0) return;
      const floor = pts.map(([x, y]) => this.project(cam, x, y, 0));
      const top = pts.map(([x, y]) => this.project(cam, x, y, height));
      const scale = top.reduce((sum, p) => sum + p[2], 0) / top.length;
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'square';
      if (height > 0.5) {
        ctx.globalAlpha = 0.2 * alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 1; i < pts.length; i++) {
          ctx.moveTo(floor[i - 1][0], floor[i - 1][1]);
          ctx.lineTo(floor[i][0], floor[i][1]);
          ctx.lineTo(top[i][0], top[i][1]);
          ctx.lineTo(top[i - 1][0], top[i - 1][1]);
          ctx.closePath();
        }
        ctx.fill();
      }
      const line = (arr) => {
        ctx.beginPath();
        ctx.moveTo(arr[0][0], arr[0][1]);
        for (let i = 1; i < arr.length; i++) ctx.lineTo(arr[i][0], arr[i][1]);
      };
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.16 * alpha;
      ctx.lineWidth = 11 * this.dpr * weight * scale;
      line(top);
      ctx.stroke();
      ctx.globalAlpha = 0.5 * alpha;
      ctx.lineWidth = 4.5 * this.dpr * weight * scale;
      line(top);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = this.palette.core;
      ctx.lineWidth = 1.5 * this.dpr * weight * scale;
      line(top);
      ctx.stroke();
      if (height > 0.5) {
        ctx.globalAlpha = 0.45 * alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * this.dpr * scale;
        line(floor);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawBattle(ctx, cam, t) {
      const lowered = this.duelStart === undefined ? 1 : 1 - ease((t - this.duelStart) / 0.9);
      const wallH = this.cell * 1.5;
      for (const cycle of this.cycles) {
        if (t < cycle.delay) {
          this.drawRezIn(ctx, cam, this.cellToWorld(cycle.x, cycle.y), cycle.color, 1 - (cycle.delay - t) / cycle.delay, DIRS[cycle.dir]);
          continue;
        }
        let alpha = 1;
        if (!cycle.alive) {
          // Derezzet: væggen flimrer og forsvinder.
          const age = t - cycle.deadAt;
          alpha = clamp(1 - age / 0.7, 0, 1) * (0.55 + 0.45 * this.random());
        }
        if (alpha <= 0 || lowered <= 0) continue;
        const pts = cycle.trail.map(([x, y]) => this.cellToWorld(x, y));
        const head = this.headWorld(cycle);
        pts.push(head);
        this.drawWall(ctx, cam, pts, wallH * lowered, cycle.color, alpha * (0.4 + 0.6 * lowered));
        if (cycle.alive && !cycle.handedOver && t <= this.battleEnd + 0.05) this.drawBike(ctx, cam, head, DIRS[cycle.dir], cycle.color, 1);
      }
    }

    drawDuel(ctx, cam, t) {
      if (!this.riders) return;
      const textH = this.cell * 0.5;
      for (const rider of this.riders) {
        const now = this.riderAt(rider, t);
        const deadAge = rider.dead ? t - rider.deadAt : 0;
        for (const seg of rider.path.segs) {
          if (seg.s0 >= now.s) break;
          const end = Math.min(seg.s1, now.s);
          const f = (end - seg.s0) / (seg.s1 - seg.s0);
          const b = [lerp(seg.a[0], seg.b[0], f), lerp(seg.a[1], seg.b[1], f)];
          if (seg.kind === 'text') {
            let weight = 1.4;
            let alpha = 1;
            if (seg.meta.final && t > this.textDone) {
              // Det sidste ord gløder op, når det er skrevet.
              weight += 1.1 * Math.max(0, Math.sin(clamp((t - this.textDone) / 0.9, 0, 1) * Math.PI));
            }
            if (rider.dead && deadAge < 0.5) alpha = 0.6 + 0.4 * this.random(); // taberens bogstaver blinker ved derez
            this.drawWall(ctx, cam, [seg.a, b], textH, rider.color, alpha, weight);
          } else {
            // Kørslen mellem bogstaverne: en tynd væg, der fader ud bag cyklen.
            const passedAt = this.duelStart + seg.s1 / rider.v;
            let alpha = end < seg.s1 ? 1 : clamp(1 - (t - passedAt - 0.3) / 0.6, 0, 1);
            if (rider.dead) alpha = 0;
            if (alpha > 0) this.drawWall(ctx, cam, [seg.a, b], textH * 0.6, rider.color, alpha * 0.7, 0.7);
          }
        }
        if (!rider.dead && !(rider.winner && now.done)) {
          const rezAge = t - this.duelStart;
          if (rider.rez && rezAge < 0.4) this.drawRezIn(ctx, cam, now.pos, rider.color, rezAge / 0.4, now.dir);
          else this.drawBike(ctx, cam, now.pos, now.dir, rider.color, 1);
        }
      }
    }

    /** En lyscykel i 3D: lav, lang krop med spids front, lysende hjul og en forlygte. Fronten er ved pos. */
    drawBike(ctx, cam, [x, y], [dx, dy], color, alpha) {
      if (!dx && !dy) dx = 1;
      const len = this.cell * 2.8;
      const wid = this.cell * 0.85;
      const hb = this.cell * 0.95;
      const rx = -dy; // højre side
      const ry = dx;
      const P = (u, v, h) => this.project(cam, x + dx * u + rx * v, y + dy * u + ry * v, h);
      const outline = [
        [-len, -wid / 2],
        [-len * 0.2, -wid / 2],
        [0, 0],
        [-len * 0.2, wid / 2],
        [-len, wid / 2],
      ];
      const bottom = outline.map(([u, v]) => P(u, v, hb * 0.1));
      const top = outline.map(([u, v]) => P(u * 0.94, v * 0.8, hb));
      ctx.globalAlpha = 0.45 * alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length;
        ctx.moveTo(bottom[i][0], bottom[i][1]);
        ctx.lineTo(bottom[j][0], bottom[j][1]);
        ctx.lineTo(top[j][0], top[j][1]);
        ctx.lineTo(top[i][0], top[i][1]);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 0.95 * alpha;
      ctx.beginPath();
      top.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = this.palette.core;
      ctx.lineWidth = 1.4 * this.dpr * top[0][2];
      ctx.stroke();
      // Lysstriben langs kroppen og cockpittet, som på cyklerne i filmen.
      const stripeA = P(-len * 0.92, 0, hb * 1.02);
      const stripeB = P(-len * 0.12, 0, hb * 1.02);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = this.palette.core;
      ctx.lineWidth = 2.2 * this.dpr * stripeA[2];
      ctx.beginPath();
      ctx.moveTo(stripeA[0], stripeA[1]);
      ctx.lineTo(stripeB[0], stripeB[1]);
      ctx.stroke();
      // Hjulene: svage ringe for og bag.
      const r = wid * 0.42;
      for (const u of [-len * 0.16, -len * 0.86]) {
        const c = P(u, 0, hb * 0.5);
        ctx.globalAlpha = 0.55 * alpha;
        ctx.lineWidth = 1.4 * this.dpr * c[2];
        ctx.beginPath();
        ctx.arc(c[0], c[1], r * c[2], 0, TAU);
        ctx.stroke();
      }
      // Forlygte.
      const nose = P(0, 0, hb * 0.5);
      const glow = ctx.createRadialGradient(nose[0], nose[1], 0, nose[0], nose[1], this.cell * 2.2 * nose[2]);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = 0.5 * alpha;
      ctx.fillStyle = glow;
      ctx.fillRect(nose[0] - this.cell * 2.2 * nose[2], nose[1] - this.cell * 2.2 * nose[2], this.cell * 4.4 * nose[2], this.cell * 4.4 * nose[2]);
      ctx.globalAlpha = 1;
    }

    /** Cyklen rezzer ind: en lyssøjle fra gulvet og en omrids-firkant, der trækker sig sammen. */
    drawRezIn(ctx, cam, [x, y], color, f, dir) {
      const k = clamp(f, 0, 1);
      const base = this.project(cam, x, y, 0);
      const high = this.project(cam, x, y, this.cell * 7 * (1 - k * 0.7));
      ctx.globalAlpha = 0.25 + 0.5 * k;
      ctx.strokeStyle = color;
      ctx.lineWidth = (6 - 4 * k) * this.dpr * base[2];
      ctx.beginPath();
      ctx.moveTo(base[0], base[1]);
      ctx.lineTo(high[0], high[1]);
      ctx.stroke();
      const size = this.cell * (3.5 - 2.5 * k);
      const sq = [
        [-size, -size],
        [size, -size],
        [size, size],
        [-size, size],
      ].map(([a, b]) => this.project(cam, x + a, y + b, 0));
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.beginPath();
      sq.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (k > 0.55) this.drawBike(ctx, cam, [x, y], dir, color, (k - 0.55) / 0.45);
    }

    drawParticles(ctx, cam, dt) {
      const gravity = 900 * this.dpr;
      for (const p of this.particles) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.h += p.vh * dt;
        p.vh -= gravity * dt;
        if (p.h < 0) {
          p.h = 0;
          p.vh *= -0.35;
          p.vx *= 0.7;
          p.vy *= 0.7;
        }
        p.vx *= 0.97;
        p.vy *= 0.97;
        const a = clamp(1 - p.age / p.life, 0, 1);
        if (a <= 0) continue;
        const [sx, sy, s] = this.project(cam, p.x, p.y, p.h);
        const size = p.size * s;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      this.particles = this.particles.filter((p) => p.age < p.life);
    }

    /** Trykbølgen på gulvet ved en derez. */
    drawRings(ctx, cam, t) {
      for (const ring of this.rings) {
        const age = t - ring.t;
        if (age > 0.6) continue;
        const radius = this.cell * (1 + 7 * ring.strength * ease(age / 0.6));
        ctx.globalAlpha = clamp(1 - age / 0.6, 0, 1) * 0.8;
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 2.5 * this.dpr;
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
          const a = (i / 28) * TAU;
          const [px, py] = this.project(cam, ring.x + Math.cos(a) * radius, ring.y + Math.sin(a) * radius, 0);
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      this.rings = this.rings.filter((ring) => t - ring.t <= 0.6);
    }

    /** Sekunder siden introen startede (bruges af selvtesten til at tage billeder på bestemte tidspunkter). */
    elapsed() {
      return this.running ? (performance.now() - this.t0) / 1000 : 0;
    }

    finish(skipped) {
      if (!this.running) return;
      this.running = false;
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this.onKey, true);
      this.root.removeEventListener('mousedown', this.onKey);
      this.root.classList.add('fading');
      setTimeout(() => {
        this.root.hidden = true;
        this.root.classList.remove('fading');
        this.onDone({ skipped, winner: this.winner || null });
      }, skipped ? 350 : 800);
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.GridIntro = GridIntro;
})();
