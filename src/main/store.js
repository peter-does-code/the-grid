'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

// Alt gemmes lokalt i Electrons userData-mappe (%APPDATA%\The Grid på Windows) — aldrig i projektmappen.
// Peters Spotify-udvikler-app, som alle bruger som standard. Et Client ID er ikke hemmeligt:
// login sker med PKCE, og der findes ingen client secret i appen. Brugere skal være tilføjet
// under "User Management" i appen på Spotify Developer Dashboard.
const BUILT_IN_CLIENT_ID = 'bf7feaf25cc94651afbf70b4c711721c';

const DEFAULT_SETTINGS = {
  clientId: '', // tomt = brug den indbyggede app
  theme: 'grid', // 'grid' | 'clu' | 'classic'
  showIntro: true,
  introMusic: true, // "Init" af Nine Inch Nails under introen
  initVolume: 1, // Inits lydstyrke i forhold til Spotifys (1 = lige så højt; se initVolume i app.js)
  introStyle: 'war', // 'war' (den lange kamp) eller 'duel' (kamp og duel)
  onboardingDone: false,
  shareVotes: null, // null = ikke spurgt endnu; true/false = brugerens svar (stemmer til Peter, src/main/votes.js)
  hiddenPresets: [], // presets brugeren har derezzet med D
  favoritePresets: [], // brugerens favoritter (K): vises oftere
  classicMode: false, // kun MilkDrops egne presets fra Winamp (Winamp-klassikerne)
  peterPicks: false, // brug også Peters favoritter og derez (src/renderer/presets/peter-picks.js)
  peterPickExceptions: [], // Peters valg, brugeren har fortrudt for sig selv (☆ eller ↺ i preset-listen)
  lastInput: '',
  visualizer: {
    autoCycle: true,
    cycleSeconds: 40, // 20 indtil 05-10-2026 (Peter: skiftede for meget); se getSettings
    blendSeconds: 2.7,
    maxFps: 60, // 0 = skærmens takt; se setMaxFps i visualizer.js
    reactivity: 0.7, // hvor meget presets reagerer på lyden (1 = som i MilkDrop); se setReactivity
    random: true,
    lastPreset: null,
  },
  // Hvordan visualizeren følger musikken (se src/shared/music-engine.js).
  music: {
    beatSync: true,
    sectionChanges: true,
    hardCuts: true,
    smartSelection: true,
    agc: true,
    latencyMs: 0,
  },
  clockMode: 'elapsed', // 'elapsed' | 'remaining'
  miniVis: 'spectrum', // 'spectrum' | 'scope' | 'off'
  windowBounds: null,
};

const CLIENT_ID_RE = /^[0-9a-f]{32}$/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function tokensFile() {
  return path.join(app.getPath('userData'), 'spotify-tokens.bin');
}

let settingsCache = null;

function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = deepMerge(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    settingsCache = deepMerge(DEFAULT_SETTINGS, {});
  }
  // Én gang: den gamle standard på 20 s mellem skift bliver den nye på 40 s. Har brugeren selv valgt en anden
  // tid, bliver den stående.
  if (!settingsCache.cycleRaised) {
    if (settingsCache.visualizer.cycleSeconds === 20) settingsCache.visualizer.cycleSeconds = DEFAULT_SETTINGS.visualizer.cycleSeconds;
    settingsCache.cycleRaised = true;
    try {
      writeAtomic(settingsFile(), JSON.stringify(settingsCache, null, 2));
    } catch {
      // gemmes ved næste ændring
    }
  }
  return settingsCache;
}

function updateSettings(patch) {
  settingsCache = deepMerge(getSettings(), patch);
  writeAtomic(settingsFile(), JSON.stringify(settingsCache, null, 2));
  return settingsCache;
}

/**
 * Spotify-tokens krypteres med Windows DPAPI via Electrons safeStorage.
 * Er kryptering ikke tilgængelig, holdes de kun i hukommelsen, og brugeren skal logge ind ved hver start.
 */
const tokenStore = {
  memory: null,

  load() {
    if (this.memory) return this.memory;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      this.memory = JSON.parse(safeStorage.decryptString(fs.readFileSync(tokensFile())));
      return this.memory;
    } catch {
      return null;
    }
  },

  save(tokens) {
    this.memory = tokens;
    if (safeStorage.isEncryptionAvailable()) {
      writeAtomic(tokensFile(), safeStorage.encryptString(JSON.stringify(tokens)));
    }
  },

  clear() {
    this.memory = null;
    try {
      fs.unlinkSync(tokensFile());
    } catch {
      // Filen fandtes ikke.
    }
  },
};

module.exports = { getSettings, updateSettings, tokenStore, deepMerge, DEFAULT_SETTINGS, CLIENT_ID_RE, BUILT_IN_CLIENT_ID };
