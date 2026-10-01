'use strict';

const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell, clipboard, screen, Menu, nativeImage } = require('electron');

const store = require('./store');
const { installLoopbackCapture } = require('./audio-capture');
const { SpotifyAuth } = require('./spotify-auth');
const { SpotifyApi } = require('./spotify-api');
const { PlaybackController } = require('./playback');
const { sendMediaKey } = require('./mediakeys');
const { parseSpotifyInput, isShortLink, findSpotifyLinkInText } = require('./spotify-parse');
const { SpotifyError } = require('./errors');
const { iconPng } = require('./icon');
const { DefaultDeviceWatcher } = require('./audio-devices');
const { startUpdater, readToken } = require('./updater');
const { VoteQueue } = require('./votes');
const i18n = require('../shared/i18n');

/**
 * Programmet hed før "Visamp" og gemte data i %APPDATA%/Visamp. Nu hedder det "The Grid".
 * Første gang kopieres indstillinger og login over. "Local State" rummer nøglen, som safeStorage
 * bruger til de krypterede tokens, og skal kopieres, før Chromium starter.
 */
function migrateFromVisamp() {
  const fs = require('node:fs');
  try {
    const current = app.getPath('userData');
    const old = path.join(app.getPath('appData'), 'Visamp');
    if (path.resolve(current) === path.resolve(old) || !fs.existsSync(old)) return;
    if (fs.existsSync(path.join(current, 'settings.json'))) return;
    fs.mkdirSync(current, { recursive: true });
    for (const file of ['Local State', 'settings.json', 'spotify-tokens.bin']) {
      if (fs.existsSync(path.join(old, file))) fs.copyFileSync(path.join(old, file), path.join(current, file));
    }
  } catch (err) {
    console.error('Could not move data from Visamp:', err);
  }
}

const IS_SELFTEST_FULL = process.argv.includes('--selftest-full');
const IS_SELFTEST = IS_SELFTEST_FULL || process.argv.includes('--selftest');
const IS_DIAGNOSE = process.argv.includes('--diagnose');
const IS_MUSICTEST = process.argv.includes('--musictest');
const IS_PRESETTEST = process.argv.includes('--presettest');
// Review-tilstand (node scripts/start.js --review): kun presets til gennemsyn (src/renderer/presets/review-pack.js),
// i et eget vindue ved siden af en åben The Grid. K beholder, D derezzer (ban).
const IS_REVIEW = process.argv.includes('--review');
// Opdateringstjekket (--update-check) kører ved siden af en åben The Grid (release.js kører det, mens Peters app er åben).
const IS_UPDATECHECK = process.argv.some((arg) => arg === '--update-check' || arg.startsWith('--update-check='));
if (!IS_SELFTEST && !IS_MUSICTEST && !IS_PRESETTEST && !IS_REVIEW && !IS_UPDATECHECK) migrateFromVisamp();
if (IS_MUSICTEST || IS_PRESETTEST || IS_REVIEW || IS_UPDATECHECK) {
  // Egen datamappe, så testen kan køre ved siden af en åben The Grid.
  app.setPath('userData', require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'the-grid-musictest-')));
}
const SELFTEST_OUT =
  (process.argv.find((arg) => arg.startsWith('--selftest-out=')) || '').slice('--selftest-out='.length) ||
  path.join(os.tmpdir(), 'the-grid-selftest');

let DIAGNOSE_DIR = null;
if (IS_DIAGNOSE) {
  // Diagnosen arbejder på en kopi af datamappen, så den kan køre ved siden af en åben The Grid uden at
  // dele Chromium-profil. "Local State" indeholder nøglen, som safeStorage bruger til at dekryptere tokens.
  const fs = require('node:fs');
  const realUserData = app.getPath('userData');
  DIAGNOSE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'the-grid-diagnose-'));
  for (const file of ['Local State', 'settings.json', 'spotify-tokens.bin']) {
    try {
      fs.copyFileSync(path.join(realUserData, file), path.join(DIAGNOSE_DIR, file));
    } catch {
      // Filen findes ikke endnu (fx ikke logget ind).
    }
  }
  app.setPath('userData', DIAGNOSE_DIR);
}

if (IS_SELFTEST) {
  // Selvtesten kører med sin egen datamappe, så den aldrig rører rigtige indstillinger eller Spotify-login.
  app.setPath('userData', path.join(SELFTEST_OUT, 'userdata'));
  // Bliv ved med at tegne, selv hvis vinduet dækkes af et andet; ellers bliver skærmbillederne forældede.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// The Grid er altid på engelsk, også Chromiums egne tekster og talformater (2.7, ikke 2,7).
app.commandLine.appendSwitch('lang', 'en-US');

const DEFAULT_BOUNDS = { width: 1200, height: 760 };
// Farver til Windows' egne vinduesknapper, så de passer til temaet.
const TITLEBAR_COLORS = {
  grid: { color: '#02070c', symbolColor: '#7fefff' },
  clu: { color: '#0c0602', symbolColor: '#ffb070' },
  classic: { color: '#1b1b27', symbolColor: '#c8cbe0' },
};
const THEMES = Object.keys(TITLEBAR_COLORS);

const EXTERNAL_HOSTS = new Set(['accounts.spotify.com', 'developer.spotify.com', 'open.spotify.com']);
const SPOTIFY_URI_RE = /^spotify:(track|album|playlist|episode):[A-Za-z0-9]{22}$/;

/** The Grid åbner kun Spotify-adresser uden for appen. */
function isAllowedExternal(url) {
  if (typeof url !== 'string') return false;
  if (url === 'spotify:' || SPOTIFY_URI_RE.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && EXTERNAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function openExternalSafe(url) {
  if (!isAllowedExternal(url)) throw new SpotifyError('BLOCKED_URL', 'The Grid only opens Spotify addresses.');
  await shell.openExternal(url);
}

const auth = new SpotifyAuth({
  // Eget Client ID, hvis brugeren har sat et; ellers den indbyggede app.
  getClientId: () => store.getSettings().clientId || store.BUILT_IN_CLIENT_ID,
  tokenStore: store.tokenStore,
  openExternal: openExternalSafe,
});
const api = new SpotifyApi({ getAccessToken: (opts) => auth.getAccessToken(opts) });
const playback = new PlaybackController({ api, auth, openExternal: openExternalSafe, sendMediaKey });
let cachedUser = null;
let mainWindow = null;
const deviceWatcher = new DefaultDeviceWatcher();

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function publicSettings(settings) {
  const { windowBounds, ...rest } = settings;
  return { ...rest, redirectUri: auth.redirectUri, builtInClientId: !rest.clientId || rest.clientId === store.BUILT_IN_CLIENT_ID };
}

async function spotifyStatus() {
  if (auth.isLoggedIn() && !cachedUser) {
    try {
      const me = await api.getMe();
      cachedUser = { id: me.id, displayName: me.display_name || me.id };
    } catch (err) {
      if (!(err instanceof SpotifyError)) console.error('Could not load the Spotify profile:', err);
    }
  }
  const loggedIn = auth.isLoggedIn();
  return {
    configured: true,
    builtIn: !store.getSettings().clientId || store.getSettings().clientId === store.BUILT_IN_CLIENT_ID,
    loggedIn,
    user: loggedIn ? cachedUser : null,
    premium: playback.premium,
    redirectUri: auth.redirectUri,
  };
}

/** Følger et kort delingslink fra mobilappen (spotify.link) til det egentlige open.spotify.com-link. */
async function resolveShortLink(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (The Grid)' } });
    return parseSpotifyInput(res.url) || findSpotifyLinkInText(res.url) || findSpotifyLinkInText(await res.text());
  } catch {
    return null;
  }
}

/** Alle IPC-kald svarer {ok, data} eller {ok:false, error:{code, message}}, så fejlkoder når frem til rendereren. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      if (!(err instanceof SpotifyError)) console.error(`[${channel}]`, err);
      return { ok: false, error: { code: err.code || 'ERROR', message: err.message || String(err), detail: err.detail, status: err.status } };
    }
  });
}

// Den udgave, der kørte sidst (sat nedenfor ved start): er den ældre, er appen lige blevet opdateret.
let UPDATED_FROM = null;

/** Stemmekøen til Peter (src/main/votes.js); kun i den installerede app. */
let voteQueue = null;

/** Brugerens anonyme stemme-id (oprettes første gang). */
function votesId() {
  let id = store.getSettings().votesId;
  if (!id) {
    id = require('node:crypto').randomBytes(4).toString('hex');
    store.updateSettings({ votesId: id });
  }
  return id;
}

function registerIpc() {
  // K = behold, D = derez. Fra kildekoden (Peter selv, også review-tilstanden) skrives de direkte i
  // scripts/preset-keeps.txt og scripts/preset-bans.txt. I den installerede app går de til Peter, hvis
  // brugeren har sagt ja (shareVotes); ellers bliver de kun på pc'en.
  handle('votes:add', (_event, name, verdict) => {
    const line = String(name || '').replace(/[\r\n]+/g, ' ').trim();
    if (!line) return { recorded: false };
    if (IS_REVIEW || !app.isPackaged) {
      const fs = require('node:fs');
      const file = path.join(app.getAppPath(), 'scripts', verdict === 'keep' ? 'preset-keeps.txt' : 'preset-bans.txt');
      fs.appendFileSync(file, line + '\n');
      return { recorded: true, where: 'lists' };
    }
    if (store.getSettings().shareVotes === true && voteQueue) {
      voteQueue.add({ preset: line, vote: verdict });
      return { recorded: true, where: 'peter' };
    }
    return { recorded: false };
  });
  handle('app:info', () => ({
    version: app.getVersion(),
    updatedFrom: UPDATED_FROM,
    packaged: app.isPackaged,
    quiet: process.argv.includes('--quiet'), // selvtesten med næsten uhørlig lyd
    selftest: IS_SELFTEST,
    appName: i18n.APP_NAME,
    locale: app.getLocale(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));

  handle('app:copyText', (_event, text) => {
    clipboard.writeText(String(text || '').slice(0, 2000));
    return true;
  });

  handle('app:openSpotifyDashboard', () => openExternalSafe('https://developer.spotify.com/dashboard'));

  handle('audio:currentDevice', () => deviceWatcher.current);

  handle('settings:get', () => publicSettings(store.getSettings()));

  handle('settings:set', (_event, patch) => {
    if (!patch || typeof patch !== 'object') throw new SpotifyError('BAD_SETTINGS', 'Invalid settings.');
    const clean = {};
    if ('clientId' in patch) {
      const clientId = String(patch.clientId || '').trim();
      if (clientId && !store.CLIENT_ID_RE.test(clientId)) {
        throw new SpotifyError('BAD_CLIENT_ID', 'A Spotify Client ID is 32 characters: digits 0-9 and letters a-f.');
      }
      if (clientId !== store.getSettings().clientId) {
        // Tokens fra et andet Client ID virker ikke længere.
        auth.logout();
        cachedUser = null;
        playback.premium = null;
      }
      clean.clientId = clientId;
    }
    if (typeof patch.lastInput === 'string') clean.lastInput = patch.lastInput.slice(0, 500);
    if (patch.visualizer && typeof patch.visualizer === 'object') {
      const v = patch.visualizer;
      const out = {};
      if ('autoCycle' in v) out.autoCycle = Boolean(v.autoCycle);
      if ('random' in v) out.random = Boolean(v.random);
      if ('cycleSeconds' in v) out.cycleSeconds = clamp(v.cycleSeconds, 5, 600, 20);
      if ('blendSeconds' in v) out.blendSeconds = clamp(v.blendSeconds, 0, 10, 2.7);
      if ('lastPreset' in v) out.lastPreset = typeof v.lastPreset === 'string' ? v.lastPreset.slice(0, 300) : null;
      clean.visualizer = out;
    }
    if (patch.music && typeof patch.music === 'object') {
      const m = patch.music;
      const out = {};
      for (const key of ['beatSync', 'sectionChanges', 'hardCuts', 'smartSelection', 'agc']) {
        if (key in m) out[key] = Boolean(m[key]);
      }
      if ('latencyMs' in m) out.latencyMs = Math.round(clamp(m.latencyMs, 0, 500, 0));
      clean.music = out;
    }
    if (patch.clockMode === 'elapsed' || patch.clockMode === 'remaining') clean.clockMode = patch.clockMode;
    if (['spectrum', 'scope', 'off'].includes(patch.miniVis)) clean.miniVis = patch.miniVis;
    if (THEMES.includes(patch.theme)) {
      clean.theme = patch.theme;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay({ ...TITLEBAR_COLORS[patch.theme], height: 30 });
    }
    if ('showIntro' in patch) clean.showIntro = Boolean(patch.showIntro);
    if ('introMusic' in patch) clean.introMusic = Boolean(patch.introMusic);
    if (['war', 'duel'].includes(patch.introStyle)) clean.introStyle = patch.introStyle;
    if ('onboardingDone' in patch) clean.onboardingDone = Boolean(patch.onboardingDone);
    // Stemmer: om de må sendes til Peter, og de presets brugeren har derezzet (skjules for brugeren selv).
    if ('shareVotes' in patch) clean.shareVotes = patch.shareVotes === null ? null : Boolean(patch.shareVotes);
    if (Array.isArray(patch.favoritePresets)) {
      clean.favoritePresets = patch.favoritePresets.filter((n) => typeof n === 'string').map((n) => n.slice(0, 300)).slice(-2000);
    }
    if (Array.isArray(patch.hiddenPresets)) {
      clean.hiddenPresets = patch.hiddenPresets.filter((n) => typeof n === 'string').map((n) => n.slice(0, 300)).slice(-2000);
    }
    return publicSettings(store.updateSettings(clean));
  });

  handle('spotify:status', () => spotifyStatus());

  // Tjekker hos Spotify, om et Client ID findes (fanger fx et indsat Client Secret).
  handle('spotify:checkClientId', (_event, clientId) => {
    const id = String(clientId || '').trim();
    if (!store.CLIENT_ID_RE.test(id)) throw new SpotifyError('BAD_CLIENT_ID', 'A Spotify Client ID is 32 characters.');
    return auth.checkClientId(id);
  });

  handle('spotify:login', async () => {
    await auth.login();
    cachedUser = null;
    playback.premium = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    return spotifyStatus();
  });

  handle('spotify:logout', () => {
    auth.logout();
    cachedUser = null;
    playback.premium = null;
    return spotifyStatus();
  });

  handle('spotify:loadCollection', async (event, input) => {
    const text = String(input || '').trim();
    let ref = parseSpotifyInput(text);
    if (!ref && isShortLink(text)) ref = await resolveShortLink(text);
    if (!ref) {
      throw new SpotifyError('BAD_LINK', 'That doesn\'t look like a Spotify link to a playlist, album or track.');
    }
    const collection = await api.getCollection(ref, {
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('spotify:loadProgress', progress);
      },
    });
    store.updateSettings({ lastInput: text });
    return collection;
  });

  handle('spotify:play', (_event, target) => playback.play(target || {}));
  handle('spotify:control', (_event, action) => playback.control(action));
  handle('spotify:seek', (_event, ms) => playback.seek(Number(ms) || 0));
  handle('spotify:volume', (_event, percent) => playback.setVolume(Number(percent) || 0));
  handle('spotify:playbackState', async () => {
    const playback = await api.getPlaybackState();
    // Spotify-appen navngiver pc'en efter computernavnet; så ved vi, om lyden kommer herfra.
    if (playback && playback.device) {
      playback.device.isThisComputer = String(playback.device.name || '').toLowerCase() === os.hostname().toLowerCase();
    }
    return playback;
  });
  handle('spotify:queue', () => api.getQueue());
}

function boundsAreVisible(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX > 120 && overlapY > 80;
  });
}

function createWindow() {
  const saved = store.getSettings().windowBounds;
  const bounds = !IS_SELFTEST && boundsAreVisible(saved) ? saved : DEFAULT_BOUNDS;

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    title: i18n.APP_NAME,
    icon: nativeImage.createFromBuffer(iconPng(64)),
    backgroundColor: '#010407',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...(TITLEBAR_COLORS[store.getSettings().theme] || TITLEBAR_COLORS.grid), height: 30 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // visualizeren skal køre videre, når vinduet ikke har fokus
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required', // introens musik starter uden et klik
    },
  });

  // Selvtesten må ikke stjæle fokus fra det, brugeren sidder og laver.
  win.once('ready-to-show', () => (IS_SELFTEST ? win.showInactive() : win.show()));
  win.on('close', () => {
    if (!IS_SELFTEST && !win.isFullScreen() && !win.isMinimized()) {
      store.updateSettings({ windowBounds: win.getNormalBounds() });
    }
  });

  // Ingen navigation væk fra appen og ingen nye vinduer; eksterne links åbnes i browseren.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Udviklerværktøjer på Ctrl+Shift+I / F12, da vinduet ikke har nogen menu.
  win.webContents.on('before-input-event', (event, input) => {
    const devtools = input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'));
    if (devtools) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), IS_REVIEW ? { query: { review: '1' } } : undefined);
  return win;
}

async function main() {
  await app.whenReady();

  if (IS_DIAGNOSE) {
    // Intet vindue: læs Spotify-tilstanden, udskriv den og afslut.
    // Login fornyes aldrig her: Spotify roterer refresh-tokens, og det ville logge den åbne app ud.
    const { runDiagnose } = require('./diagnose');
    const getAccessTokenWithoutRefresh = async () => {
      const tokens = store.tokenStore.load();
      if (!tokens || !tokens.accessToken) throw new SpotifyError('NOT_LOGGED_IN', 'Ikke logget ind.');
      if (tokens.expiresAt <= Date.now()) {
        throw new SpotifyError('TOKEN_EXPIRED', 'The access token has expired. Open The Grid so it renews it, then run the diagnosis again.');
      }
      return tokens.accessToken;
    };
    const makeApi = (fetchImpl) => new SpotifyApi({ getAccessToken: getAccessTokenWithoutRefresh, fetchImpl });
    let exitCode = 0;

    const audioArg = process.argv.find((arg) => arg === '--audio' || arg.startsWith('--audio='));
    if (audioArg) {
      // Lyt med på det, der spiller, i et skjult vindue, og rapportér hvad musikmotoren hører.
      const seconds = Number(audioArg.split('=')[1]) || 30;
      installLoopbackCapture(session.defaultSession);
      const reportPromise = new Promise((resolve) => ipcMain.handleOnce('probe:report', (_event, data) => resolve(data)));
      const probeWin = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      probeWin.loadFile(path.join(__dirname, '..', 'renderer', 'probe.html'), { query: { seconds: String(seconds) } });
      const report = await Promise.race([
        reportPromise,
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'No report from the audio diagnosis.' }), (seconds + 30) * 1000)),
      ]);
      console.log(JSON.stringify(report, null, 2));
      try {
        require('node:fs').rmSync(DIAGNOSE_DIR, { recursive: true, force: true });
      } catch {
        // Chromium kan holde enkelte filer; mappen ligger i %TEMP%.
      }
      app.exit(report && report.ok ? 0 : 1);
      return;
    }

    try {
      const report = await runDiagnose({
        auth,
        store,
        makeApi,
        tryPlay: process.argv.includes('--play'),
        experiment: process.argv.some((arg) => arg === '--experiment' || arg.startsWith('--experiment=')),
      });
      console.log(JSON.stringify(report, null, 2));
    } catch (err) {
      console.error('Diagnosen fejlede:', err);
      exitCode = 1;
    }
    try {
      require('node:fs').rmSync(DIAGNOSE_DIR, { recursive: true, force: true });
    } catch {
      // Chromium kan stadig holde enkelte cachefiler; mappen ligger i %TEMP%.
    }
    app.exit(exitCode);
    return;
  }

  if (IS_MUSICTEST) {
    // Skjult vindue: analysekæden mod en syntetisk sang med kendt facit (ingen lyd).
    const reportPromise = new Promise((resolve) => ipcMain.handleOnce('musictest:report', (_event, data) => resolve(data)));
    // Med --file=<sti> analyseres en lydfil i stedet for den syntetiske sang.
    const fileArg = (process.argv.find((arg) => arg.startsWith('--file=')) || '').slice('--file='.length);
    ipcMain.handleOnce('musictest:file', () => (fileArg ? require('node:fs').readFileSync(fileArg) : null));
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.error(`[renderer] ${event.message}`);
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'musictest.html'));
    const report = await Promise.race([
      reportPromise,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'The music test did not finish within 3 minutes.' }), 180000)),
    ]);
    console.log(JSON.stringify(report, null, 2));
    try {
      require('node:fs').rmSync(app.getPath('userData'), { recursive: true, force: true });
    } catch {
      // Chromium kan holde enkelte filer; mappen ligger i %TEMP%.
    }
    app.exit(report && report.ok ? 0 : 1);
    return;
  }

  const updateCheckArg = process.argv.find((arg) => arg === '--update-check' || arg.startsWith('--update-check='));
  if (updateCheckArg) {
    // Fejlsøgning af opdateringer i den installerede app: ét tjek, resultatet som JSON, så lukker appen.
    // --update-check=<fil> skriver til en fil (release.js); ellers til konsollen, og appen venter, til teksten er
    // sendt (app.exit med det samme tabte den, når outputtet gik gennem et rør).
    const result = await require('./updater').checkOnce({ publish: require('./update-config') });
    const json = JSON.stringify(result, null, 2);
    try {
      require('node:fs').rmSync(app.getPath('userData'), { recursive: true, force: true }); // egen midlertidig datamappe
    } catch {
      // Chromium kan holde enkelte filer; mappen ligger i %TEMP%.
    }
    const file = updateCheckArg.slice('--update-check='.length);
    if (file) {
      require('node:fs').writeFileSync(file, json);
      app.exit(0);
    } else {
      process.stdout.write(json + '\n', () => app.exit(0));
    }
    return;
  }

  if (IS_PRESETTEST) {
    // Skjult vindue: tegner hvert konverteret preset i --dir (med manifest.json fra
    // scripts/convert-presets.js) og skriver målingerne til --out, én JSON-linje pr. preset, efter hver
    // portion. Afbrydes testen, fortsætter en ny kørsel med de presets, der mangler. Se renderer/presettest.js.
    const fs = require('node:fs');
    const argValue = (name) => (process.argv.find((arg) => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3);
    const dir = argValue('dir');
    const outFile = argValue('out') || path.join(dir, 'results.jsonl');
    const done = new Set();
    if (fs.existsSync(outFile)) {
      for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) {
        try {
          if (line.trim()) done.add(JSON.parse(line).file);
        } catch {
          // en halvt skrevet sidste linje fra en afbrudt kørsel
        }
      }
    }
    // --manifest=<fil> tester kun et udvalg (fx de valgte fra scripts/build-preset-pack.js til kontaktark).
    const manifestFile = argValue('manifest') || path.join(dir, 'manifest.json');
    const all = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).filter((e) => !e.error);
    const entries = all.filter((e) => !done.has(e.file));
    console.log(`${done.size} already tested, ${entries.length} to go`);
    const started = Date.now();
    ipcMain.handle('presettest:batch', (_event, start, count) => {
      const batch = entries
        .slice(start, start + count)
        .map((e) => ({ file: e.file, name: e.name, json: fs.readFileSync(path.join(dir, e.file), 'utf8') }));
      if (start % 200 === 0 && batch.length) console.log(`${start}/${entries.length} (${Math.round((Date.now() - started) / 1000)} s)`);
      return batch;
    });
    ipcMain.handle('presettest:results', (_event, results) => {
      fs.appendFileSync(outFile, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
    });
    // Med --sheets=<mappe>: kontaktark (4x4 små billeder med navn) af presets, til at se på udvalget.
    const sheetsDir = argValue('sheets');
    ipcMain.handle('presettest:options', () => ({ sheets: Boolean(sheetsDir) }));
    ipcMain.handle('presettest:sheet', (_event, index, dataUrl) => {
      fs.mkdirSync(sheetsDir, { recursive: true });
      const file = path.join(sheetsDir, `sheet-${String(index).padStart(3, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    });
    const reportPromise = new Promise((resolve) => ipcMain.handleOnce('presettest:report', (_event, data) => resolve(data)));
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'presettest.html'));
    const report = await Promise.race([
      reportPromise,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'The preset test did not finish within 3 hours.' }), 3 * 3600 * 1000)),
    ]);
    console.log(report.ok ? `Preset test done: ${outFile}` : `Preset test failed: ${report.error}`);
    try {
      fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
    } catch {
      // Chromium kan holde enkelte filer; mappen ligger i %TEMP%.
    }
    app.exit(report.ok ? 0 : 1);
    return;
  }

  Menu.setApplicationMenu(null);
  installLoopbackCapture(session.defaultSession);
  registerIpc();
  if (!IS_SELFTEST) {
    const last = store.getSettings().lastVersion;
    if (last && last !== app.getVersion()) UPDATED_FROM = last;
    if (last !== app.getVersion()) store.updateSettings({ lastVersion: app.getVersion() });
  }
  mainWindow = createWindow();
  if (!IS_SELFTEST && app.isPackaged) {
    const publish = require('./update-config');
    voteQueue = new VoteQueue({
      dir: app.getPath('userData'),
      token: readToken(),
      owner: publish.owner,
      repo: publish.repo,
      version: app.getVersion(),
      getId: votesId,
      log: console,
    });
    // Stemmer fra sidst (uden net, eller lukket før de blev sendt) sendes kort efter start.
    setTimeout(() => voteQueue.flush(), 15000);
    app.on('before-quit', () => {
      voteQueue.flush();
    });
  }
  if (!IS_SELFTEST) {
    startUpdater({
      log: console,
      publish: require('./update-config'),
      send: (channel, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
      },
    });
  }

  // Skifter brugeren højttaler, skal lydfangsten startes forfra på den nye standardenhed.
  deviceWatcher.on('device', (device, info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audio:device', { ...device, changed: info.changed });
  });
  deviceWatcher.start();
  app.on('will-quit', () => deviceWatcher.stop());

  if (IS_SELFTEST) {
    const { runSelftest } = require('./selftest');
    try {
      const result = await runSelftest({ win: mainWindow, ipcMain, outDir: SELFTEST_OUT, full: IS_SELFTEST_FULL });
      console.log(`Selftest done: ${path.join(SELFTEST_OUT, 'report.json')}`);
      console.log(JSON.stringify(result.report, null, 2));
      app.exit(result.report && result.report.ok ? 0 : 1);
    } catch (err) {
      console.error('Selvtesten fejlede:', err);
      app.exit(2);
    }
    return;
  }

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.on('window-all-closed', () => app.quit());

if (IS_SELFTEST || IS_DIAGNOSE || IS_MUSICTEST || IS_REVIEW || IS_UPDATECHECK || app.requestSingleInstanceLock()) {
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  });
} else {
  app.quit();
}
