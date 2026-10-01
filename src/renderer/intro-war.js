/*
 * Introen "The long battle" (standard). Bygger på GridIntro i intro.js, som stadig er den anden intro
 * ("Battle and duel"), og genbruger dens kamera, lysvægge, cykler og effekter.
 *
 *   1. En lang kamp, hvor cyklerne elimineres én efter én. En "instruktør" styrer tempoet, så feltet
 *      tyndes jævnt ud fra 16 til 2 over cirka 11 sekunder.
 *   2. Mens kampen stadig raser, bryder cykler ud, kører op i tekstfeltet øverst på the Grid og skriver
 *      "WELCOME TO THE" med deres lysvægge: det orange hold "WELCOME", det cyan "TO THE". Vejen til hvert
 *      bogstav findes gennem hullerne mellem væggene (BFS), og bagefter går cyklen tilbage i kampen.
 *   3. De sidste to (én fra hvert hold) kæmper et øjeblik, til den ene derezzer.
 *   4. Vinderen kører op og skriver "GRID", mens kameraet drejer ned over teksten.
 * Tekstfeltet er forbudt område for kampens cykler; kun skriverne må køre derind.
 */
(function () {
  'use strict';

  const Base = window.Visamp.GridIntro;
  const Font = window.GridFont;
  const DIRS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const ZONE = 31000; // tekstfeltet: spærret for kampens cykler
  const LETTER = 32000; // bogstavvægge

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, f) => a + (b - a) * f;
  const ease = (f) => {
    const x = clamp(f, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const dirIndex = (dx, dy) => DIRS.findIndex(([a, b]) => a === Math.sign(dx) && b === Math.sign(dy));

  class GridIntroWar extends Base {
    /**
     * Samme valg som GridIntro, plus:
     *   duelAt       hvornår der skal være to tilbage (sekunder)
     *   duelSeconds  hvor længe de to sidste kæmper
     *   winnerText   (navn) => { title, sub }: teksten, når der kun kæmpes, og ét hold har vundet
     */
    constructor(root, canvas, opts = {}) {
      super(root, canvas, opts);
      this.duelAt = opts.duelAt || (this.battleOnly ? opts.battleSeconds || 16 : 11);
      this.duelSeconds = opts.duelSeconds || 2;
      this.battleEnd = Infinity; // GridIntros egen duel bruges ikke
      this.writerSpeed = 40; // celler pr. sekund; skriverne kører målrettet
      this.letters = [];
      this.hunts = []; // igangværende drab: { hunter, prey, t, deadline }
      this.huntBoost = opts.huntBoost || 1.35; // jægerens fart under et drab
      this.huntBoostFinal = opts.huntBoostFinal || 1.6; // ... og i finalen
      this.trailSeconds = opts.trailSeconds || 7; // så lang en lysvæg trækker hver cykel efter sig
      this.trailSecondsFinal = opts.trailSecondsFinal || 4; // ... og i finalen
      this.fading = [];
      this.jobs = [];
      this.lastTwoAt = undefined;
      this.finalAt = undefined;
      this.winnerText = opts.winnerText || ((name) => ({ title: `${name.toUpperCase()} WINS`, sub: '' }));
    }

    // ---------- Opsætning ----------

    setupBattle() {
      const { cols, rows } = this;
      this.zoneBottom = this.battleOnly ? -1 : Math.floor(rows * 0.44);
      this.zoneMask = new Uint8Array(cols * rows);
      for (let y = 0; y <= this.zoneBottom; y++) {
        for (let x = 0; x < cols; x++) {
          this.zoneMask[this.index(x, y)] = 1;
          this.occupied[this.index(x, y)] = ZONE;
        }
      }
      this.stateStamp = new Int32Array(cols * rows * 4);
      this.statePrev = new Int32Array(cols * rows * 4);
      this.stateQueue = new Int32Array(cols * rows * 4);
      this.stamp = 0;

      this.cycles = [];
      const perTeam = Math.ceil(this.cycleCount / 2);
      const lo = this.zoneBottom + 3;
      const hi = rows - 3;
      for (let i = 0; i < this.cycleCount; i++) {
        const team = i % 2;
        const slot = Math.floor(i / 2);
        const frac = (slot + 0.5 + (team ? 0.5 : 0)) / (perTeam + 0.5);
        const y = clamp(Math.round(lo + (hi - lo) * frac), lo, hi);
        const x = team ? cols - 3 : 2;
        const cycle = {
          id: i + 1,
          team,
          color: this.palette.sides[team],
          x,
          y,
          dir: team ? 2 : 0,
          progress: 0,
          speed: 18 + this.random() * 4,
          trail: [[x, y]],
          alive: true,
          deadAt: null,
          delay: 0.5 + slot * 0.22 + this.random() * 0.15, // holdene rezzer ind efterhånden
          doomed: false,
          mode: 'ai',
        };
        this.cycles.push(cycle);
        this.lay(cycle);
      }
      if (!this.battleOnly) this.setupText();
    }

    /** Lægger teksten ud i tekstfeltet på cellegitteret og deler den op i skriveopgaver. */
    setupText() {
      const [line1, line2 = ''] = this.lines;
      const layout = Font.layout([line1, line2]);
      const zoneRows = this.zoneBottom;
      const u = Math.min((this.cols - 6) / layout.width, (zoneRows - 3) / layout.height);
      const cx = (this.cols - 1) / 2;
      const cy = (zoneRows - 1) / 2;
      const toCell = ([x, y]) => [clamp(Math.round(cx + x * u), 0, this.cols - 1), clamp(Math.round(cy + y * u), 0, zoneRows - 1)];

      const letterWord = [];
      let letter = 0;
      [line1, line2].forEach((line, lineNo) => {
        line.split(' ').filter(Boolean).forEach((word, w) => {
          for (let i = 0; i < word.length; i++) letterWord[letter++] = { line: lineNo, word: w, pos: i, len: word.length };
        });
      });
      const words2 = line2.split(' ').filter(Boolean);
      const finalWord = words2.length - 1;

      const strokes = [];
      for (const s of layout.strokes) {
        const pts = [];
        for (const p of s.points.map(toCell)) {
          const last = pts[pts.length - 1];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
        }
        if (pts.length >= 2) strokes.push({ pts, ...letterWord[s.letter], letter: s.letter });
      }

      // Opgaver: linje 1 (orange) i bidder på højst fire bogstaver, starten af linje 2 (cyan) ord for ord,
      // og det sidste ord, som vinderen skriver til sidst.
      const groups = new Map();
      for (const s of strokes) {
        const isFinal = s.line === 1 && s.word === finalWord;
        let chunk = 0;
        if (!isFinal && s.len > 4) chunk = s.pos < Math.ceil(s.len / 2) ? 0 : 1;
        const key = isFinal ? 'final' : `${s.line}:${s.word}:${chunk}`;
        if (!groups.has(key)) groups.set(key, { strokes: [], team: s.line === 0 ? 1 : 0, final: isFinal });
        groups.get(key).strokes.push(s.pts);
      }
      const regular = [...groups.values()].filter((g) => !g.final);
      const spacing = regular.length > 1 ? clamp((this.duelAt - 2.2 - 4.2) / (regular.length - 1), 0.5, 1.4) : 0;
      regular.forEach((job, i) => {
        job.at = 2.2 + i * spacing;
        job.color = this.palette.sides[job.team];
      });
      this.jobs = regular;
      this.finalJob = groups.get('final') || null;
      if (this.finalJob) this.finalJob.color = this.palette.sides[0];

      // Tekstens udstrækning i verden (til kameraets slutbillede).
      const all = strokes.flatMap((s) => s.pts.map(([x, y]) => this.cellToWorld(x, y)));
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      this.textBox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }

    // ---------- Instruktøren: tempo, duel og finale ----------

    aliveCycles() {
      return this.cycles.filter((c) => c.alive);
    }

    /** Hvor mange der bør være tilbage lige nu: jævnt ned fra alle til to (eller én ved kun kamp). */
    target(t) {
      const last = this.battleOnly ? 1 : 2;
      const n = this.cycles.length;
      return Math.max(last, Math.round(n - (n - last) * clamp((t - 2.5) / (this.duelAt - 2.5), 0, 1)));
    }

    /** Må cyklen slippe for at dø lige nu? */
    shouldSave(cycle, t) {
      if (cycle.prey) return false; // bliver skåret af lige nu
      if (t < (cycle.protectedUntil || 0)) return true;
      if (cycle.finalLoser) return false;
      const alive = this.aliveCycles();
      if (!this.battleOnly && alive.filter((c) => c.team === cycle.team).length <= 1) return true;
      if (cycle.doomed) return false;
      return alive.length - 1 < this.target(t); // for mange er døde for tidligt
    }

    direct(t) {
      const alive = this.aliveCycles();
      // Tempo: for mange tilbage? Så arrangeres et drab: en jæger skærer et bytte af, så byttet kører ind i
      // jægerens væg. Kun hvis intet drab kan lade sig gøre i et stykke tid, sendes én i væggen.
      if (this.lastTwoAt === undefined && t - (this.lastDirect || 0) > 0.25) {
        this.lastDirect = t;
        const pending = alive.filter((c) => c.doomed || c.prey).length;
        const behind = alive.length - pending - this.target(t);
        if (behind > 0 && this.hunts.length < (behind >= 3 || t > this.duelAt ? 4 : 3)) {
          if (this.tryKill(t)) this.killDue = null;
          else if (this.killDue === null || this.killDue === undefined) this.killDue = t;
          else if (t - this.killDue > (t > this.duelAt ? 1.5 : 2.5)) {
            this.killDue = null;
            this.doomOne(alive, t);
          }
        } else {
          this.killDue = null;
        }
      }
      this.updateHunts(t);
      // Skriveopgaverne gives til en cykel fra holdet, der er tæt på.
      for (const job of this.jobs) if (!job.assigned && t >= job.at) this.tryAssign(job, t);

      const busy = this.jobs.some((j) => !j.done);
      if (this.lastTwoAt === undefined && !busy && alive.length <= 2 && t > 3) {
        this.lastTwoAt = t;
        this.duelAt = Math.min(this.duelAt, t);
        for (const c of alive) {
          c.doomed = false;
          c.protectedUntil = t + this.duelSeconds;
          if (c.prey) this.release(c); // en jagt fra før duellen må ikke afgøre den
          if (c.mode === 'hunt') this.endHunt(c);
        }
        this.updateHunts(t);
      }
      if (this.lastTwoAt !== undefined && !this.loserChosen && t >= this.lastTwoAt + this.duelSeconds && alive.length >= 2) {
        this.loserChosen = true;
        const teams = new Set(alive.map((c) => c.team));
        // Med tekst vinder det cyan hold og skriver det sidste ord; uden tekst er det åbent.
        let loser = teams.size > 1 ? alive.find((c) => c.team === 1) : alive[1];
        if (this.battleOnly) loser = alive[Math.floor(this.random() * alive.length)];
        const winner = alive.find((c) => c !== loser);
        loser.finalLoser = true;
        loser.protectedUntil = 0;
        winner.protectedUntil = Infinity;
        this.finalPair = { winner, loser, since: t };
      }
      // Finalen: vinderen jagter taberen, til den skærer den af. Lykkes det ikke på 5 s, kører taberen i væggen.
      if (this.finalPair && this.finalPair.loser.alive && !this.hunts.length && t - (this.lastFinalTry || 0) > 0.2) {
        this.lastFinalTry = t;
        const { winner, loser, since } = this.finalPair;
        if (winner.alive && winner.mode === 'ai' && !this.tryKill(t, winner, loser)) {
          if (t - since > 6) loser.doomed = true;
          else this.stalk(winner, loser);
        }
      }
      if (this.lastTwoAt !== undefined && this.finalJob && !this.finalJob.assigned && alive.length === 1) {
        this.finalAt = t;
        this.duelStart = t; // får GridIntro til at sænke arenaens kant (drawFloor)
        this.assignJob(alive[0], this.finalJob, t);
      }
      if (!this.finalJob && this.endAt === undefined && t > 3 && alive.length <= 1 && (this.lastTwoAt !== undefined || this.battleOnly)) {
        // Kun kamp: der er en vinder (eller, meget sjældent, derezzede de sidste to samtidig).
        const champion = alive[0];
        if (champion) {
          champion.protectedUntil = Infinity;
          this.winner = { team: champion.team, name: this.palette.names[champion.team], color: champion.color };
          this.champion = champion;
        }
        this.winnerAt = t;
        this.textDone = t;
        this.endAt = t + 3.2;
      }
    }

    // ---------- Drab: en jæger skærer et bytte af ----------

    /**
     * Finder en jæger og et bytte fra hvert sit hold, hvor jægeren kan nå et punkt på byttets bane før
     * byttet selv (med jægerens fartforøgelse), og krydse banen på tværs, så byttet kører ind i væggen.
     * Returnerer true, hvis et drab er sat i gang.
     */
    tryKill(t, forcedHunter = null, forcedPrey = null) {
      // Finalen (en bestemt jæger og et bestemt bytte): længere rækkevidde og et kraftigere ryk.
      const final = Boolean(forcedHunter && forcedPrey);
      // Bagud i forhold til tidsplanen (eller en finale, der trækker ud): jægerne rækker længere og rykker hårdere.
      const late = final ? t - this.finalPair.since > 2.5 : t > this.duelAt;
      const reach = final ? 70 : late ? 60 : 38;
      const boost = final ? this.huntBoostFinal * (late ? 1.3 : 1) : this.huntBoost * (late ? 1.15 : 1);
      const hesitate = final && late ? 0.4 : 0.55;
      const busy = (c) => c.mode !== 'ai' || c.prey || c.hunting || c.doomed || t < c.delay + 1;
      const alive = this.aliveCycles();
      const teamSize = [0, 1].map((team) => alive.filter((c) => c.team === team).length);
      let preys = forcedPrey ? [forcedPrey] : alive.filter((c) => !busy(c) && (this.battleOnly || teamSize[c.team] > 1));
      // Det største hold mister helst én, så de to sidste bliver én fra hvert hold.
      if (!forcedPrey && !this.battleOnly && teamSize[0] !== teamSize[1]) {
        const bigger = preys.filter((c) => teamSize[c.team] > teamSize[1 - c.team]);
        if (bigger.length) preys = bigger;
      }
      const hunters = forcedHunter ? [forcedHunter] : alive.filter((c) => !busy(c));
      // Kandidater: for hver jæger ét afstandskort (bredde-først over frie felter), og for hvert bytte det
      // første felt på dets bane, jægeren kan nå i tide.
      const candidates = [];
      for (const hunter of hunters) {
        const enemies = preys.filter((p) => p !== hunter && p.team !== hunter.team && Math.abs(hunter.x - p.x) + Math.abs(hunter.y - p.y) <= reach);
        if (!enemies.length) continue;
        const dist = this.distanceField(hunter, reach + 6);
        for (const prey of enemies) {
          const [dx, dy] = DIRS[prey.dir];
          const run = this.runLength(prey.x, prey.y, prey.dir, 40);
          for (let k = 3; k < run; k++) {
            const cx = prey.x + dx * k;
            const cy = prey.y + dy * k;
            const d = dist[this.index(cx, cy)];
            if (d < 0) continue;
            const hunterTime = d / ((hunter.baseSpeed || hunter.speed) * boost);
            let preySpeed = prey.speed;
            let preyTime = (k - prey.progress) / preySpeed;
            // Finalen: taberen tøver, når vinderen går til angreb (ned til 55 % af farten), så afskæringen
            // kan lade sig gøre fra næsten enhver position.
            if (final && preyTime - hunterTime < 0.3) {
              preySpeed = (k - prey.progress) / (hunterTime + 0.3);
              if (preySpeed < (prey.baseSpeed || prey.speed) * hesitate) continue;
              preyTime = (k - prey.progress) / preySpeed;
            }
            const margin = preyTime - hunterTime;
            if (margin < 0.12) continue;
            // Hellere et hurtigt drab med lidt margen end en lang jagt.
            candidates.push({ score: -preyTime - 0.5 * Math.abs(margin - 0.35), hunter, prey, cross: [cx, cy], d, preySpeed });
            break;
          }
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      // Den egentlige vej: jægeren skal ankomme på tværs af byttets retning, så væggen spærrer banen.
      let best = null;
      for (const c of candidates.slice(0, 6)) {
        const [cx, cy] = c.cross;
        const path = this.findPath(c.hunter, (x, y) => x === cx && y === cy, (nd) => nd % 2 !== c.prey.dir % 2, false);
        if (!path || path.length > c.d + 6) continue;
        const hunterTime = path.length / ((c.hunter.baseSpeed || c.hunter.speed) * boost);
        const preyTime = (Math.abs(cx - c.prey.x) + Math.abs(cy - c.prey.y) - c.prey.progress) / c.preySpeed;
        if (preyTime - hunterTime < 0.12) continue;
        best = { ...c, path };
        break;
      }
      if (!best) return false;
      const { hunter, prey, path, cross } = best;
      // Fortsæt et par felter efter krydset, så væggen spærrer hele vejen på tværs.
      const [ax, ay] = path.length >= 2 ? [cross[0] - path[path.length - 2][0], cross[1] - path[path.length - 2][1]] : [0, 0];
      const plan = path.slice();
      for (let s = 1; s <= 2; s++) {
        const nx = cross[0] + ax * s;
        const ny = cross[1] + ay * s;
        if (!this.free(nx, ny)) break;
        plan.push([nx, ny]);
      }
      hunter.mode = 'hunt';
      hunter.hunting = prey;
      hunter.plan = plan;
      hunter.baseSpeed = hunter.baseSpeed || hunter.speed;
      hunter.speed = hunter.baseSpeed * boost;
      prey.prey = hunter;
      if (best.preySpeed < prey.speed) {
        prey.baseSpeed = prey.baseSpeed || prey.speed;
        prey.speed = best.preySpeed;
      }
      this.hunts.push({ hunter, prey, t, cross, preyDir: prey.dir, deadline: t + 3.5 });
      return true;
    }

    /**
     * Finalen, når et drab endnu ikke kan lade sig gøre (typisk fordi vinderen er bag taberen): vinderen
     * kører mod stedet, taberen er på vej hen, et stykke foran den, så den kan skære den af derfra.
     * Et kort stykke ad gangen; derefter prøves drabet igen.
     */
    stalk(winner, loser) {
      const [dx, dy] = DIRS[loser.dir];
      const ahead = Math.max(3, Math.min(this.runLength(loser.x, loser.y, loser.dir, 30) - 1, 15));
      const tx = clamp(loser.x + dx * ahead, 0, this.cols - 1);
      const ty = clamp(loser.y + dy * ahead, this.zoneBottom + 1, this.rows - 1);
      // Står en væg imellem, køres der hen til det felt, vinderen kan nå, der ligger tættest på.
      const dist = this.distanceField(winner, 90);
      let goal = null;
      let bestScore = Infinity;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] <= 0) continue;
        const x = i % this.cols;
        const y = (i - x) / this.cols;
        const score = Math.abs(x - tx) + Math.abs(y - ty) + 0.25 * dist[i];
        if (score < bestScore) {
          bestScore = score;
          goal = [x, y];
        }
      }
      if (!goal) return;
      const path = this.findPath(winner, (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]) <= 1, -1, false);
      if (!path || path.length < 2) return;
      winner.mode = 'hunt';
      winner.plan = path.slice(0, 8);
      winner.baseSpeed = winner.baseSpeed || winner.speed;
      winner.speed = winner.baseSpeed * this.huntBoostFinal;
    }

    /** Antal felter fra cyklen til hvert frit felt (-1: kan ikke nås), op til `limit` felter væk. */
    distanceField(cycle, limit) {
      const { cols, rows, occupied } = this;
      const dist = new Int16Array(cols * rows).fill(-1);
      const queue = this.queue;
      let head = 0;
      let tail = 0;
      const start = this.index(cycle.x, cycle.y);
      dist[start] = 0;
      queue[tail++] = start;
      while (head < tail) {
        const i = queue[head++];
        const d = dist[i];
        if (d >= limit) continue;
        const x = i % cols;
        const y = (i - x) / cols;
        const push = (j) => {
          if (dist[j] === -1 && occupied[j] === 0) {
            dist[j] = d + 1;
            queue[tail++] = j;
          }
        };
        if (x > 0) push(i - 1);
        if (x < cols - 1) push(i + 1);
        if (y > 0) push(i - cols);
        if (y < rows - 1) push(i + cols);
      }
      return dist;
    }

    /** Afslutter jagter: byttet er dødt, jægeren er færdig med sin bane, eller tiden er gået. */
    updateHunts(t) {
      for (const hunt of this.hunts) {
        const { hunter, prey, cross, preyDir } = hunt;
        // Byttet holder kursen, til det har ramt væggen eller er kommet forbi krydset (jægeren var for sen).
        const [dx, dy] = DIRS[preyDir];
        const passed = (prey.x - cross[0]) * dx + (prey.y - cross[1]) * dy > 0;
        const over = !prey.alive || passed || t > hunt.deadline;
        if (!over) continue;
        hunt.done = true;
        prey.prey = null;
        if (prey.baseSpeed) prey.speed = prey.baseSpeed; // tøven slut
        if (hunter.alive && hunter.mode === 'hunt') this.endHunt(hunter);
        hunter.hunting = null;
      }
      this.hunts = this.hunts.filter((h) => !h.done);
    }

    /** Byttet slipper fri (det undveg noget andet end jægerens væg): jagten afsluttes ved næste updateHunts. */
    release(prey) {
      for (const hunt of this.hunts) if (hunt.prey === prey) hunt.deadline = -1;
      prey.prey = null;
      if (prey.baseSpeed) prey.speed = prey.baseSpeed;
    }

    /**
     * Som GridIntro.chooseDir, men mere forsigtig i den tætte kamp: ser længere frem (et større
     * fyld-område), holder sig ude af smalle korridorer mellem vægge og angriber kun fra et sted med plads.
     * Så dør cyklerne af modstandernes afskæringer i stedet for at lukke sig selv inde.
     */
    chooseDir(cycle) {
      if (cycle.doomed) return super.chooseDir(cycle);
      const options = [cycle.dir, (cycle.dir + 1) % 4, (cycle.dir + 3) % 4];
      const target = this.nearestEnemy(cycle);
      let best = null;
      let bestScore = -Infinity;
      for (const dir of options) {
        const [dx, dy] = DIRS[dir];
        const nx = cycle.x + dx;
        const ny = cycle.y + dy;
        if (!this.free(nx, ny)) continue;
        const room = this.space(nx, ny, 260);
        let score = (room / 260) * 10 + Math.min(this.runLength(cycle.x, cycle.y, dir), 10) * 0.35 + this.random() * 1.2;
        if (room < 30) score -= 14; // en blindgyde
        else if (room < 90) score -= 6; // en korridor, der snart lukker
        else if (room < 160) score -= 1.5;
        if (dir === cycle.dir) score += 1.6;
        // Andres forhjul på vej mod samme sted lukker snart hullet.
        for (const o of this.cycles) {
          if (o === cycle || !o.alive || !o.started) continue;
          const d = Math.abs(o.x - nx) + Math.abs(o.y - ny);
          if (d > 4) continue;
          const [ox, oy] = DIRS[o.dir];
          if (Math.abs(o.x + ox - nx) + Math.abs(o.y + oy - ny) < d) score -= o.team === cycle.team ? 3 : 1.5;
        }
        if (target && room >= 160) {
          const { enemy, dist } = target;
          const [ex, ey] = DIRS[enemy.dir];
          const ahead = Math.min(10, Math.round(dist * 0.6) + 2);
          const px = enemy.x + ex * ahead;
          const py = enemy.y + ey * ahead;
          if (Math.abs(px - nx) + Math.abs(py - ny) < Math.abs(px - cycle.x) + Math.abs(py - cycle.y)) score += 3;
          const perpendicular = dx * ex + dy * ey === 0;
          const inFront = (cycle.x - enemy.x) * ex + (cycle.y - enemy.y) * ey > 0;
          if (perpendicular && inFront && dist < 16) score += 3;
        }
        if (score > bestScore) {
          bestScore = score;
          best = dir;
        }
      }
      return best;
    }

    endHunt(hunter) {
      hunter.mode = 'ai';
      hunter.plan = [];
      hunter.speed = hunter.baseSpeed || hunter.speed;
    }

    /** Nødløsning, når intet drab kan arrangeres: én fra det største hold kører i væggen. */
    doomOne(alive, t) {
      const teamSize = [0, 1].map((team) => alive.filter((c) => c.team === team && !c.doomed).length);
      const candidates = alive.filter(
        (c) => c.mode === 'ai' && !c.doomed && !c.prey && !c.hunting && t >= c.delay + 1 && (this.battleOnly || teamSize[c.team] > 1)
      );
      const bigger = candidates.filter((c) => teamSize[c.team] >= Math.max(...teamSize));
      const pool = bigger.length ? bigger : candidates;
      if (pool.length) pool[Math.floor(this.random() * pool.length)].doomed = true;
    }

    tryAssign(job, t) {
      const start = job.strokes[0][0];
      const pool = this.aliveCycles().filter((c) => c.mode === 'ai' && !c.doomed && t >= c.delay + 0.5);
      const team = pool.filter((c) => c.team === job.team);
      const candidates = team.length ? team : pool;
      if (!candidates.length) return;
      const dist = (c) => Math.abs(c.x - start[0]) + Math.abs(c.y - start[1]);
      candidates.sort((a, b) => dist(a) - dist(b));
      this.assignJob(candidates[0], job, t);
    }

    assignJob(cycle, job, t) {
      job.assigned = true;
      job.writer = cycle;
      job.color = cycle.color;
      cycle.mode = 'route';
      cycle.job = job;
      cycle.strokeIndex = 0;
      cycle.doomed = false;
      cycle.baseSpeed = cycle.baseSpeed || cycle.speed;
      cycle.speed = job.final ? this.writerSpeed * 1.15 : this.writerSpeed;
      this.planToStroke(cycle);
    }

    // ---------- Vejfinding for skriverne ----------

    /**
     * Korteste vej gennem frie celler (BFS over celle og retning), uden at vende 180 grader. `goal(x, y)`
     * afgør målet; `forbidArrive` er en retning, cyklen ikke må ankomme i (så den ikke skal vende på stedet).
     */
    findPath(cycle, goal, forbidArrive = -1, allowZone = true) {
      const { cols, rows, occupied } = this;
      // forbidArrive: en retning, der ikke må ankommes i, eller en funktion (retning) => tilladt.
      const arriveOk = typeof forbidArrive === 'function' ? forbidArrive : (nd) => nd !== forbidArrive;
      const stamp = ++this.stamp;
      const start = this.index(cycle.x, cycle.y) * 4 + cycle.dir;
      let head = 0;
      let tail = 0;
      this.stateQueue[tail++] = start;
      this.stateStamp[start] = stamp;
      this.statePrev[start] = -1;
      while (head < tail) {
        const s = this.stateQueue[head++];
        const cell = s >> 2;
        const d = s & 3;
        const x = cell % cols;
        const y = (cell - x) / cols;
        for (let nd = 0; nd < 4; nd++) {
          if (nd === (d + 2) % 4) continue;
          const nx = x + DIRS[nd][0];
          const ny = y + DIRS[nd][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ncell = this.index(nx, ny);
          const ns = ncell * 4 + nd;
          if (this.stateStamp[ns] === stamp) continue;
          const isGoal = goal(nx, ny) && arriveOk(nd);
          const o = occupied[ncell];
          if (!isGoal && o !== 0 && !(allowZone && o === ZONE)) continue;
          this.stateStamp[ns] = stamp;
          this.statePrev[ns] = s;
          if (isGoal) {
            const path = [];
            for (let p = ns; p !== start && p !== -1; p = this.statePrev[p]) {
              const c = p >> 2;
              path.push([c % cols, Math.floor(c / cols)]);
            }
            return path.reverse();
          }
          this.stateQueue[tail++] = ns;
        }
      }
      return null;
    }

    /** Nødløsning, hvis alt er spærret: vinkelvej direkte hen til målet (cyklen er immun, mens den skriver). */
    straightPath(from, to) {
      const path = [];
      let [x, y] = from;
      while (x !== to[0]) path.push([(x += Math.sign(to[0] - x)), y]);
      while (y !== to[1]) path.push([x, (y += Math.sign(to[1] - y))]);
      return path;
    }

    planToStroke(cycle) {
      const stroke = cycle.job.strokes[cycle.strokeIndex];
      const [sx, sy] = stroke[0];
      const firstDir = dirIndex(stroke[1][0] - sx, stroke[1][1] - sy);
      if (cycle.x === sx && cycle.y === sy) {
        cycle.plan = [];
        return;
      }
      cycle.plan =
        this.findPath(cycle, (x, y) => x === sx && y === sy, (firstDir + 2) % 4) ||
        this.findPath(cycle, (x, y) => x === sx && y === sy) ||
        this.straightPath([cycle.x, cycle.y], [sx, sy]);
    }

    planExit(cycle) {
      const free = (x, y) => !this.zoneMask[this.index(x, y)] && this.occupied[this.index(x, y)] === 0;
      cycle.plan = this.findPath(cycle, free) || this.straightPath([cycle.x, cycle.y], [cycle.x, this.zoneBottom + 1]);
    }

    /** Alle celler langs en streg (uden startcellen). */
    expand(pts) {
      const cells = [];
      for (let i = 1; i < pts.length; i++) cells.push(...this.straightPath(pts[i - 1], pts[i]));
      return cells;
    }

    /** Cyklens gamle væg derezzer bag den (når den begynder at skrive, eller vender tilbage til kampen). */
    cutTrail(cycle, t) {
      const pts = cycle.trail.concat([[cycle.x, cycle.y]]);
      if (pts.length >= 2) this.fading.push({ pts: pts.map(([x, y]) => this.cellToWorld(x, y)), color: cycle.color, t });
      for (let i = 0; i < this.occupied.length; i++) if (this.occupied[i] === cycle.id) this.occupied[i] = this.zoneMask[i] ? ZONE : 0;
      cycle.trail = [[cycle.x, cycle.y, cycle.seq || 0]];
      cycle.cells = [];
    }

    // ---------- Bevægelse ----------

    updateBattle(t, dt) {
      this.direct(t);
      for (const cycle of this.cycles) {
        if (!cycle.alive || t < cycle.delay) continue;
        cycle.started = true;
        cycle.progress += cycle.speed * dt;
        while (cycle.progress >= 1 && cycle.alive) {
          cycle.progress -= 1;
          if (cycle.mode === 'ai') this.stepAI(cycle, t);
          else this.stepScripted(cycle, t);
        }
      }
      // Væggene fra derezzede cykler forsvinder, så de andre kan køre der igen.
      for (const cycle of this.cycles) {
        if (!cycle.alive && !cycle.cleared && t - cycle.deadAt > 0.8) {
          cycle.cleared = true;
          for (let i = 0; i < this.occupied.length; i++) if (this.occupied[i] === cycle.id) this.occupied[i] = this.zoneMask[i] ? ZONE : 0;
        }
      }
    }

    /**
     * Hvad cyklen kørte ind i: 'enemy' (en modstanders væg: et rigtigt drab), 'ally', 'own', 'border',
     * 'zone' (tekstfeltets kant) eller 'letter'. Bruges af testen til at måle, om kampen føles ægte.
     */
    causeOf(cycle, x, y) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 'border';
      const owner = this.occupied[this.index(x, y)];
      if (owner === ZONE) return 'zone';
      if (owner === LETTER) return 'letter';
      if (owner === cycle.id) return 'own';
      const other = this.cycles.find((c) => c.id === owner);
      if (!other) return 'border';
      return other.team !== cycle.team ? 'enemy' : 'ally';
    }

    /** Cyklen kører ind i feltet (x, y) og derezzer; et drab tælles hos den, der ejede væggen. */
    crash(cycle, x, y, t) {
      cycle.cause = this.causeOf(cycle, x, y);
      if (cycle.cause === 'enemy') {
        const killer = this.cycles.find((c) => c.id === this.occupied[this.index(x, y)]);
        if (killer) {
          killer.kills = (killer.kills || 0) + 1;
          cycle.killedBy = killer.id;
        }
      }
      this.derez(cycle, t);
    }

    stepAI(cycle, t) {
      let [dx, dy] = DIRS[cycle.dir];
      let ghost = false;
      if (!this.free(cycle.x + dx, cycle.y + dy)) {
        // Som i en rigtig kamp: man dør, når en modstander skærer én af. Uheld (egen væg, holdkammeratens
        // eller arenaens kant) undviges, hvis der er en vej ud. Byttet i et drab og de dømte undviger ikke.
        const cause = this.causeOf(cycle, cycle.x + dx, cycle.y + dy);
        // Byttet dør i jægerens væg; andre dør kun af en modstanders væg, når instruktøren vil have et drab.
        const killed = cause === 'enemy' && (cycle.prey || !this.shouldSave(cycle, t));
        if (killed || cycle.doomed) {
          this.crash(cycle, cycle.x + dx, cycle.y + dy, t);
          return;
        }
        // Byttet undviger alt andet end modstanderens væg; så er jagten forbi.
        if (cycle.prey) this.release(cycle);
        const escape = this.chooseDir({ ...cycle, doomed: false });
        if (escape === null) {
          // Lukket inde. Er en modstanders væg en del af fælden, er det modstanderens drab: kør ind i den.
          const enemyDir = [cycle.dir, (cycle.dir + 1) % 4, (cycle.dir + 3) % 4].find(
            (d) => this.causeOf(cycle, cycle.x + DIRS[d][0], cycle.y + DIRS[d][1]) === 'enemy'
          );
          if (cycle.finalLoser ? enemyDir !== undefined : !this.shouldSave(cycle, t)) {
            const d = enemyDir === undefined ? cycle.dir : enemyDir;
            if (d !== cycle.dir) {
              this.turn(cycle);
              cycle.dir = d;
            }
            this.crash(cycle, cycle.x + DIRS[d][0], cycle.y + DIRS[d][1], t);
            return;
          }
        }
        if (escape === null) {
          // Må ikke dø endnu, men er lukket inde: kører et øjeblik gennem væggen (aldrig ud over kanten).
          ghost = true;
          const inside = [cycle.dir, (cycle.dir + 1) % 4, (cycle.dir + 3) % 4].filter((d) => {
            const gx = cycle.x + DIRS[d][0];
            const gy = cycle.y + DIRS[d][1];
            return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows;
          });
          const d = inside.reduce(
            (best, d) => (this.space(cycle.x + 2 * DIRS[d][0], cycle.y + 2 * DIRS[d][1]) > this.space(cycle.x + 2 * DIRS[best][0], cycle.y + 2 * DIRS[best][1]) ? d : best),
            inside[0]
          );
          if (d !== undefined && d !== cycle.dir) {
            this.turn(cycle);
            cycle.dir = d;
            [dx, dy] = DIRS[d];
          }
        } else {
          this.turn(cycle);
          cycle.dir = escape;
          [dx, dy] = DIRS[cycle.dir];
        }
      }
      const nx = cycle.x + dx;
      const ny = cycle.y + dy;
      if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) {
        cycle.cause = "border";
        this.derez(cycle, t); // arenaens kant kan ingen køre igennem
        return;
      }
      cycle.x = nx;
      cycle.y = ny;
      if (!ghost) this.lay(cycle);
      this.grind(cycle, dx, dy);
      if (cycle.prey) return; // byttet ser ikke jægeren komme og holder kursen
      // Taberen i finalen holder kursen på lange, frie strækninger; det giver vinderen en chance for at skære den af.
      if (cycle.finalLoser && this.runLength(cycle.x, cycle.y, cycle.dir, 12) >= 8 && this.space(cycle.x + dx, cycle.y + dy, 200) >= 200) return;
      if (cycle.doomed) {
        // Dømt: vend én gang mod den nærmeste væg, og kør så lige ind i den.
        if (!cycle.aimed) {
          cycle.aimed = true;
          const options = [cycle.dir, (cycle.dir + 1) % 4, (cycle.dir + 3) % 4];
          const nearest = options.reduce((best, d) => (this.runLength(cycle.x, cycle.y, d, 60) < this.runLength(cycle.x, cycle.y, best, 60) ? d : best));
          if (nearest !== cycle.dir) {
            this.turn(cycle);
            cycle.dir = nearest;
          }
        }
        return;
      }
      const dir = this.chooseDir(cycle);
      if (dir !== null && dir !== cycle.dir) {
        this.turn(cycle);
        cycle.dir = dir;
      }
    }

    /** Skriverne: følg planen celle for celle (de kan ikke derezze, mens de har en opgave). */
    stepScripted(cycle, t) {
      if (!cycle.plan.length) {
        this.arrive(cycle, t);
        if (!cycle.plan.length) return;
      }
      let next = cycle.plan[0];
      if (cycle.mode === 'hunt') {
        // Jægeren kører på sin egen fare: er vejen spærret, opgiver den drabet og kører videre som normalt.
        const o = this.occupied[this.index(next[0], next[1])];
        if (o !== 0) {
          this.endHunt(cycle);
          return;
        }
      } else if (cycle.mode !== 'write') {
        const o = this.occupied[this.index(next[0], next[1])];
        const last = cycle.plan.length === 1;
        if (!last && o !== 0 && o !== ZONE) {
          // Nogen har kørt en væg hen over vejen: find en ny.
          if (cycle.mode === 'route') this.planToStroke(cycle);
          else this.planExit(cycle);
          if (!cycle.plan.length) return;
          next = cycle.plan[0];
        }
      }
      cycle.plan.shift();
      const nd = dirIndex(next[0] - cycle.x, next[1] - cycle.y);
      if (nd >= 0 && nd !== cycle.dir) {
        if (cycle.mode === 'write') cycle.letter.pts.push([cycle.x, cycle.y]);
        else this.turn(cycle);
        cycle.dir = nd;
      }
      cycle.x = next[0];
      cycle.y = next[1];
      if (cycle.mode === 'write') this.occupied[this.index(cycle.x, cycle.y)] = LETTER;
      else this.lay(cycle);
      if (!cycle.plan.length) this.arrive(cycle, t);
    }

    arrive(cycle, t) {
      if (cycle.mode === 'hunt') {
        this.endHunt(cycle); // væggen ligger på tværs af byttets bane
        return;
      }
      const job = cycle.job;
      if (cycle.mode === 'route') {
        // Ved stregens start: den gamle væg derezzer, og bogstavet begynder.
        this.cutTrail(cycle, t);
        cycle.mode = 'write';
        cycle.letter = { pts: [[cycle.x, cycle.y]], color: cycle.color, final: job.final };
        cycle.plan = this.expand(job.strokes[cycle.strokeIndex]);
        this.occupied[this.index(cycle.x, cycle.y)] = LETTER;
      } else if (cycle.mode === 'write') {
        cycle.letter.pts.push([cycle.x, cycle.y]);
        this.letters.push({ ...cycle.letter, pts: cycle.letter.pts.map(([x, y]) => this.cellToWorld(x, y)) });
        cycle.letter = null;
        cycle.trail = [[cycle.x, cycle.y]];
        cycle.strokeIndex += 1;
        if (cycle.strokeIndex < job.strokes.length) {
          cycle.mode = 'route';
          this.planToStroke(cycle);
        } else {
          job.done = true;
          job.doneAt = t;
          if (job.final) {
            this.textDone = t;
            this.endAt = t + 2.4;
          }
          cycle.mode = 'exit';
          this.planExit(cycle);
        }
      } else if (cycle.mode === 'exit') {
        // Tilbage i kampen.
        cycle.mode = 'ai';
        cycle.job = null;
        cycle.speed = cycle.baseSpeed || cycle.speed;
        this.cutTrail(cycle, t);
        this.lay(cycle);
      }
    }

    /**
     * Lysvæggene har en hale, der derezzer: en cykel lægger højst trailSeconds sekunders væg, og den
     * ældste del forsvinder bag den. Ellers deler de to sidste cyklers vægge efter 20 s arenaen op i
     * lukkede rum, så ingen kan nå hinanden, og finalen ikke kan afgøres af et rigtigt drab.
     */
    lay(cycle) {
      const i = this.index(cycle.x, cycle.y);
      this.occupied[i] = cycle.id;
      cycle.seq = (cycle.seq || 0) + 1;
      if (!cycle.cells) cycle.cells = [];
      cycle.cells.push({ i, x: cycle.x, y: cycle.y, seq: cycle.seq });
      // I finalen derezzer væggene hurtigere, så arenaen åbner sig, og vinderen kan nå taberen.
      const seconds = this.finalPair ? this.trailSecondsFinal : this.trailSeconds;
      const max = Math.round((cycle.baseSpeed || cycle.speed) * seconds);
      for (let n = 0; cycle.cells.length > max && n < 3; n++) {
        const old = cycle.cells.shift();
        if (this.occupied[old.i] === cycle.id) this.occupied[old.i] = this.zoneMask[old.i] ? ZONE : 0;
      }
      // Polylinjen følger med: knæk før halen forsvinder, og det første punkt flyttes hen til halen.
      const tail = cycle.cells[0];
      if (tail && cycle.trail.length) {
        while (cycle.trail.length >= 2 && (cycle.trail[1][2] || 0) <= tail.seq) cycle.trail.shift();
        cycle.trail[0] = [tail.x, tail.y, tail.seq];
      }
    }

    /** Et knæk i væggen (cyklen drejer), med løbenummeret for feltet, det ligger på. */
    turn(cycle) {
      cycle.trail.push([cycle.x, cycle.y, cycle.seq || 0]);
    }

    /** Gnister langs andres vægge (men ikke langs kanten af tekstfeltet). */
    grind(cycle, dx, dy) {
      for (const side of [-1, 1]) {
        const nx = cycle.x - dy * side;
        const ny = cycle.y + dx * side;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const owner = this.occupied[this.index(nx, ny)];
        if (owner === 0 || owner === cycle.id || owner === ZONE) continue;
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

    // ---------- Kamera ----------

    camera(t) {
      const settle = ease(t / 2.4);
      const span = Math.max(4, this.duelAt);
      let tilt = lerp(lerp(1.15, 0.92, settle), 0.78, ease((t - 3) / span));
      let yaw = lerp(-0.4, 0.25, ease(t / span)) + 0.05 * Math.sin(t * 0.8);
      let zoom = lerp(1.5, 1.12, settle);
      let lift = this.H * lerp(0.2, 0.08, settle);
      const alive = this.cycles.filter((c) => c.alive && t >= c.delay);
      let fx = this.W / 2;
      let fy = this.H / 2;
      if (alive.length) {
        fx = lerp(fx, alive.reduce((sum, c) => sum + this.headWorld(c)[0], 0) / alive.length, 0.55);
        fy = lerp(fy, alive.reduce((sum, c) => sum + this.headWorld(c)[1], 0) / alive.length, 0.55);
      }
      if (!this.focus) this.focus = [fx, fy];
      const k = 1 - Math.exp(-(t - (this.lastCamT || 0)) * 2);
      this.lastCamT = t;
      this.focus = [lerp(this.focus[0], fx, k), lerp(this.focus[1], fy, k)];
      let [cx, cy] = this.focus;
      if (this.finalAt !== undefined && this.textBox) {
        // Vinderen skriver GRID: kameraet drejer ned og indrammer teksten.
        const b = ease((t - this.finalAt) / 1.8);
        const box = this.textBox;
        const zText = Math.min((this.W * 0.86) / (box.x1 - box.x0 + this.cell * 4), (this.H * 0.62) / (box.y1 - box.y0 + this.cell * 4));
        tilt = lerp(tilt, 0, b);
        yaw = lerp(yaw, 0, b);
        zoom = lerp(zoom, zText, b);
        lift = lerp(lift, 0, b);
        cx = lerp(cx, (box.x0 + box.x1) / 2, b);
        cy = lerp(cy, (box.y0 + box.y1) / 2, b);
      }
      if (this.winnerAt !== undefined && this.champion) {
        // Kun kamp: kameraet kører ind på vinderen.
        const b = ease((t - this.winnerAt) / 1.2);
        const [wx, wy] = this.headWorld(this.champion);
        cx = lerp(cx, wx, b);
        cy = lerp(cy, wy, b);
        zoom *= lerp(1, 1.4, b);
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

    // ---------- Tegning ----------

    drawBattle(ctx, cam, t) {
      const cell = this.cell;
      // Kanten af tekstfeltet: en lav, svag væg.
      const fade = this.finalAt === undefined ? 1 : 1 - ease((t - this.finalAt) / 1.2);
      if (this.zoneBottom >= 0 && fade > 0) {
        const y = this.oy + (this.zoneBottom + 1) * cell;
        this.drawWall(ctx, cam, [[this.ox, y], [this.ox + this.cols * cell, y]], cell * 0.35 * fade, this.palette.border, 0.22 * fade, 0.6);
      }
      for (const f of this.fading) {
        const age = t - f.t;
        if (age > 0.7) continue;
        this.drawWall(ctx, cam, f.pts, cell * 1.5 * (1 - age / 0.7), f.color, (1 - age / 0.7) * (0.5 + 0.5 * this.random()));
      }
      this.fading = this.fading.filter((f) => t - f.t <= 0.7);
      const letterH = cell * 1.1;
      for (const letter of this.letters) {
        let weight = 1.3;
        if (letter.final && this.textDone !== undefined && t > this.textDone) {
          weight += 1.1 * Math.max(0, Math.sin(clamp((t - this.textDone) / 0.9, 0, 1) * Math.PI));
        }
        this.drawWall(ctx, cam, letter.pts, letterH, letter.color, 1, weight);
      }
      for (const cycle of this.cycles) {
        if (t < cycle.delay) {
          this.drawRezIn(ctx, cam, this.cellToWorld(cycle.x, cycle.y), cycle.color, 1 - (cycle.delay - t) / cycle.delay, DIRS[cycle.dir]);
          continue;
        }
        let alpha = 1;
        if (!cycle.alive) alpha = clamp(1 - (t - cycle.deadAt) / 0.7, 0, 1) * (0.55 + 0.45 * this.random());
        if (alpha <= 0) continue;
        const head = this.headWorld(cycle);
        if (cycle.mode === 'write' && cycle.letter) {
          const pts = cycle.letter.pts.map(([x, y]) => this.cellToWorld(x, y)).concat([head]);
          this.drawWall(ctx, cam, pts, letterH, cycle.color, 1, 1.3);
        } else {
          const pts = cycle.trail.map(([x, y]) => this.cellToWorld(x, y)).concat([head]);
          this.drawWall(ctx, cam, pts, cell * 1.5, cycle.color, alpha);
        }
        if (cycle.alive) this.drawBike(ctx, cam, head, DIRS[cycle.dir], cycle.color, 1);
      }
      if (this.winnerAt !== undefined && this.battleOnly) this.drawWinner(ctx, t);
    }

    /** Kun kamp: holdets sejr står med stor tekst over the Grid. */
    drawWinner(ctx, t) {
      const f = ease((t - this.winnerAt - 0.3) / 0.5);
      if (f <= 0) return;
      const { title, sub } = this.winner ? this.winnerText(this.winner.name) : this.winnerText(null);
      const color = this.winner ? this.winner.color : this.palette.border;
      const size = Math.min(this.W * 0.11, 150 * this.dpr);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.55 * f;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, this.H * 0.5 - size * 0.95, this.W, size * 1.9);
      ctx.globalAlpha = f;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${size}px VT323, monospace`;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30 * this.dpr;
      ctx.fillStyle = color;
      const scale = lerp(1.3, 1, f);
      ctx.translate(this.W / 2, this.H * 0.5 - size * 0.12);
      ctx.scale(scale, scale);
      ctx.fillText(title, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 10 * this.dpr;
      ctx.fillText(title, 0, 0);
      if (sub) {
        ctx.font = `${size * 0.28}px VT323, monospace`;
        ctx.fillStyle = color;
        ctx.fillText(sub, 0, size * 0.62);
      }
      ctx.restore();
    }
  }

  window.Visamp.GridIntroWar = GridIntroWar;
})();
