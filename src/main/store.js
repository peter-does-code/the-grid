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
  followSpotify: true, // playlisten eller albummet, Spotify spiller, vises af sig selv (followSpotifyContext i app.js)
  classicMode: false, // kun MilkDrops egne presets fra Winamp (Winamp-klassikerne)
  peterPicks: false, // brug også Peters favoritter og derez (src/renderer/presets/peter-picks.js)
  peterPickExceptions: [], // Peters valg, brugeren har fortrudt for sig selv (☆ eller ↺ i preset-listen)
  lastInput: '',
  visualizer: {
    autoCycle: true,
    cycleSeconds: 40, // 20 indtil 05-10-2026 (Peter: skiftede for meget); se getSettings
    blendSeconds: 2.7,
    maxFps: 30, // 0 = skærmens takt; se setMaxFps i visualizer.js. 30 som i Winamp (Peter 05-10-2026; 60 før)
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

/*
 * Indstillingsfilen gemmer kun det, brugeren (eller appen) har ændret; resten kommer fra DEFAULT_SETTINGS. Så når
 * en ny udgave ændrer en standard, får alle, der ikke selv har valgt noget, den nye, og ingen får overskrevet et
 * eget valg (Peter 05-10-2026). Før gemtes hele objektet med standarderne, så en ny standard nåede aldrig ud.
 */
let rawSettings = null; // det, der står i filen
let settingsCache = null; // DEFAULT_SETTINGS + rawSettings

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Fjerner værdier, der er lig standarden (rekursivt), og tomme objekter. */
function stripDefaults(raw, defaults) {
  const out = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const def = defaults ? defaults[key] : undefined;
    if (isPlainObject(value) && isPlainObject(def)) {
      const inner = stripDefaults(value, def);
      if (Object.keys(inner).length) out[key] = inner;
    } else if (def === undefined || !same(value, def)) {
      out[key] = value;
    }
  }
  return out;
}

function saveRaw() {
  writeAtomic(settingsFile(), JSON.stringify(rawSettings, null, 2));
}

function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    rawSettings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {};
  } catch {
    rawSettings = {};
  }
  // Én gang for en fil fra før 05-10-2026, hvor standarderne blev gemt med: værdier, der bare er standarden,
  // fjernes, så kommende standarder når ud. Den gamle standard på 20 s mellem skift regnes som standard (den nye
  // er 40 s); alt andet, brugeren har valgt, bliver stående.
  if (!rawSettings.sparseSettings && Object.keys(rawSettings).length) {
    if (!rawSettings.cycleRaised && rawSettings.visualizer && rawSettings.visualizer.cycleSeconds === 20) {
      delete rawSettings.visualizer.cycleSeconds;
    }
    delete rawSettings.cycleRaised;
    rawSettings = stripDefaults(rawSettings, DEFAULT_SETTINGS);
    rawSettings.sparseSettings = true;
    try {
      saveRaw();
    } catch {
      // gemmes ved næste ændring
    }
  }
  settingsCache = deepMerge(DEFAULT_SETTINGS, rawSettings);
  return settingsCache;
}

function updateSettings(patch) {
  getSettings();
  rawSettings = deepMerge(rawSettings, patch);
  rawSettings.sparseSettings = true;
  settingsCache = deepMerge(DEFAULT_SETTINGS, rawSettings);
  saveRaw();
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
