/*
 * Påskeæg fra Tron. Link-feltet i playlisten fungerer som en lille ENCOM-terminal: skriv et ord fra
 * Tron og tryk Enter. Konami-koden (↑↑↓↓←→←→BA) virker overalt.
 */
(function () {
  'use strict';

  // Konami-koden uden B og A: ↑↑↓↓←→←→.
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright'];

  // Ord → handling. Normaliseret: små bogstaver, uden tegnsætning.
  const COMMANDS = {
    flynn: 'flynn',
    'flynn lives': 'flynn',
    'kevin flynn': 'flynn',
    clu: 'clu',
    mcp: 'mcp',
    'master control program': 'mcp',
    'end of line': 'mcp',
    bit: 'bit',
    zuse: 'jazz',
    castor: 'jazz',
    'bio digital jazz': 'jazz',
    biojazz: 'jazz',
    'bio jazz': 'jazz',
    biodigital: 'jazz',
    'biodigital jazz': 'jazz',
    jazz: 'jazz',
    user: 'users',
    users: 'users',
    'i fight for the users': 'users',
    'greetings program': 'greetings',
    greetings: 'greetings',
    derez: 'derez',
    derezzed: 'derez',
    encom: 'encom',
    'os 12': 'encom',
    zen: 'zen',
    rinzler: 'rinzler',
    // Flynns terminal, som Sam finder i kælderen under Flynn's Arcade i Tron: Legacy. Det første, han skriver, er whoami.
    whoami: 'terminal',
    drew: 'drew',
    drewbraham: 'drew',
    drewtopia: 'drew',
    // Med mellemrum: næsten rigtigt. Bit forklarer, at programmer ikke bruger mellemrum.
    'who am i': 'spaces',
    'who am i ': 'spaces',
    battle: 'battle',
    'game grid': 'battle',
    gamegrid: 'battle',
  };

  /**
   * Snydearket, som terminalen viser med "cat easter_eggs.txt". Hver linje er [det man skriver, tekstnøgle i i18n.js].
   * Testen i test/eggs.test.js sikrer, at alle handlinger i COMMANDS står her.
   */
  const CHEAT_SHEET = [
    ['flynn', 'sheet.flynn', 'flynn'],
    ['clu', 'sheet.clu', 'clu'],
    ['mcp / end of line', 'sheet.mcp', 'mcp'],
    ['bit <question>', 'sheet.bit', 'bit'],
    ['derez', 'sheet.derez', 'derez'],
    ['rinzler', 'sheet.rinzler', 'rinzler'],
    ['users', 'sheet.users', 'users'],
    ['greetings program', 'sheet.greetings', 'greetings'],
    ['jazz / biojazz', 'sheet.jazz', 'jazz'],
    ['encom', 'sheet.encom', 'encom'],
    ['zen', 'sheet.zen', 'zen'],
    ['drew / drewtopia', 'sheet.drew', 'drew'],
    ['whoami', 'sheet.whoami', 'terminal'],
    ['who am i', 'sheet.spaces', 'spaces'],
    ['battle / game grid', 'sheet.battle', 'battle'],
    // Kun i Flynns terminal (fjerde felt 'terminal'): de virker ikke fra link-feltet.
    ['tron', 'sheet.overlay', 'overlay', 'terminal'],
    ['epic battle', 'sheet.epic', 'epic', 'terminal'],
    ['↑ ↑ ↓ ↓ ← → ← →', 'sheet.konami', null],
    ['double-click THE GRID', 'sheet.wordmark', null],
  ];

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  class Eggs {
    constructor() {
      this.keys = [];
    }

    /** Et påskeæg-ord fra link-feltet, eller null. */
    command(text) {
      const words = normalize(text);
      // "bit, will this work?" — Bit svarer kun ja eller nej.
      if (/^(hey )?bit /.test(words)) return 'bit';
      return COMMANDS[words] || null;
    }

    /**
     * Følger tastetryk. Returnerer 'konami', når koden er fuldført, ellers null.
     */
    key(key) {
      const k = String(key || '').toLowerCase();
      this.keys.push(k);
      if (this.keys.length > KONAMI.length) this.keys.shift();
      const n = this.keys.length;
      // Hvor lang en del af koden matcher de seneste taster?
      for (let len = Math.min(n, KONAMI.length); len > 0; len--) {
        const tail = this.keys.slice(n - len);
        if (tail.every((x, i) => x === KONAMI[i])) {
          if (len === KONAMI.length) {
            this.keys = [];
            return 'konami';
          }
          return null;
        }
      }
      return null;
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.Eggs = Eggs;
  window.Visamp.EGG_COMMANDS = COMMANDS;
  window.Visamp.EGG_CHEAT_SHEET = CHEAT_SHEET;
})();
