/*
 * The Grid — samler afspiller, playliste, visualizer, Spotify-forbindelsen, introen,
 * opsætningsguiden og påskeæggene.
 */
(function () {
  'use strict';

  const F = window.VisampFormat;
  const I18N = window.GridI18n;
  const bridge = window.visamp;
  const $ = (id) => document.getElementById(id);

  const POLL_MS = 3000;
  const LCD_TICK_MS = 120;
  const MARQUEE_STEP_MS = 190;
  const CURSOR_HIDE_MS = 2000;
  const GUIDE_FULL = ['welcome', 'login', 'sound', 'playlist', 'done'];
  // "Just visualize what's playing": uden Spotify, kun lydtjek (Peter 05-10-2026).
  const GUIDE_AUDIO = ['welcome', 'sound', 'done'];
  let GUIDE_PAGES = GUIDE_FULL;

  // Alle tekster kommer fra src/shared/i18n.js (altid engelsk).
  const t = I18N.t;

  const state = {
    info: null,
    settings: null,
    spotify: { configured: false, loggedIn: false, user: null, premium: null, redirectUri: '' },
    collection: null,
    queueTracks: null,
    selectedIndex: -1,
    playback: null,
    playbackReceivedAt: 0,
    lastTrackId: null,
    stopped: false,
    capture: { ok: false, error: null, track: null, source: null, stream: null },
    captureMessage: { key: 'capture.notYet', values: null },
    outputDevice: null,
    seeking: false,
    volumeDragging: false,
    loading: false,
    loadingText: null,
  };

  let audioContext = null;
  let music = null;
  let director = null;
  let viz = null;
  let mini = null;
  let list = null;
  let eggs = null;
  let mediaKeyHintShown = false;

  // ---------- Hjælpere ----------

  /** IPC-svar er {ok, data} eller {ok:false, error}; gør det til en almindelig værdi eller en fejl med kode. */
  async function call(promise) {
    const res = await promise;
    if (res && res.ok) return res.data;
    const info = (res && res.error) || {};
    const err = new Error(info.message || t('generic.unknown'));
    err.code = info.code || 'ERROR';
    err.detail = info.detail || '';
    err.status = info.status;
    throw err;
  }

  /** Brugervenlig tekst for en fejl på det valgte sprog. Hovedprocessens beskeder er kun en nødløsning. */
  function errorText(err, fallbackKey) {
    const key = err && err.code ? `err.${err.code}` : null;
    if (key && I18N.has(key)) return t(key, { detail: err.detail || '' });
    if (fallbackKey) return t(fallbackKey);
    return (err && err.message) || t('generic.error');
  }

  let toastTimer = null;
  function toast(message, kind = 'info', ms = 4500, onClick = null) {
    const el = $('toast');
    el.textContent = message;
    el.dataset.kind = kind;
    // En besked kan være klikbar (fx "genstart nu" ved en opdatering).
    el.onclick = onClick;
    el.classList.toggle('clickable', Boolean(onClick));
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }

  function reportError(err, fallbackKey) {
    console.warn(err);
    toast(errorText(err, fallbackKey), 'error', 6500);
    if (err && ['NOT_LOGGED_IN', 'INVALID_CLIENT', 'NOT_CONFIGURED'].includes(err.code)) refreshSpotifyStatus();
  }

  let pendingSettings = null;
  let settingsTimer = null;
  function saveSettingsSoon(patch) {
    pendingSettings = pendingSettings || {};
    for (const [key, value] of Object.entries(patch)) {
      pendingSettings[key] =
        value && typeof value === 'object' && !Array.isArray(value) ? { ...(pendingSettings[key] || {}), ...value } : value;
    }
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(async () => {
      const toSave = pendingSettings;
      pendingSettings = null;
      try {
        state.settings = await call(bridge.setSettings(toSave));
      } catch (err) {
        console.warn('Could not save settings:', err);
      }
    }, 600);
  }

  function isTyping(target) {
    return Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
  }

  // ---------- Tekster og tema ----------

  /** Sætter alle faste tekster ud fra data-i18n*-attributterne i index.html. */
  function applyTranslations() {
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle) + (el.dataset.key ? ` (${el.dataset.key})` : '');
    }
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    $('about-line').textContent = t('about', { version: `v${state.info.version}` });
    showUpdateInAbout();
  }

  // ---------- Opdateringer (src/main/updater.js) ----------

  let updateStatus = { state: 'idle' };
  function showUpdateInAbout() {
    const base = t('about', { version: `v${state.info.version}` });
    $('about-line').textContent =
      updateStatus.state === 'ready' ? `${base} ${t('update.about.ready', { version: `v${updateStatus.version}` })}` : base;
  }

  /**
   * En hentet opdatering installeres med det samme (Peter 01-10-2026: "full update and restart when detected"):
   * 10 s varsel, så genstart. Musikken spiller videre i Spotify; efter genstarten springes introen over.
   */
  function restartForUpdate() {
    toast(t('update.restarting', { version: `v${updateStatus.version}` }), 'info', 11000);
    setTimeout(() => window.visamp.update.installNow(), 10000);
  }

  function setupUpdates() {
    if (state.info.updatedFrom) toast(t('update.done', { version: `v${state.info.version}` }), 'info', 7000);
    const onStatus = (status) => {
      const wasReady = updateStatus.state === 'ready';
      updateStatus = status || { state: 'idle' };
      if (updateStatus.state === 'ready' && !wasReady) {
        restartForUpdate();
      }
      showUpdateInAbout();
    };
    window.visamp.update.onStatus(onStatus);
    window.visamp.update.status().then(onStatus, () => {});
  }

  function currentTheme() {
    return document.body.dataset.theme || 'grid';
  }

  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    if (mini) mini.setPalette(theme);
    if (tronOverlay) tronOverlay.setTheme(theme);
    $('set-theme').value = theme;
  }

  /** Temaet gemmes med det samme, så hovedprocessen kan farve vinduets knapper i samme stil. */
  async function setTheme(theme) {
    applyTheme(theme);
    try {
      state.settings = await call(bridge.setSettings({ theme }));
    } catch (err) {
      reportError(err);
    }
  }

  // ---------- Visualizer og musikmotor ----------

  const SILENT_FRAME = { rms: 0, rmsDb: -180, bass: 0, mid: 0, treb: 0, flux: 0, kickFlux: 0 };

  function nowSeconds() {
    return performance.now() / 1000;
  }

  function initVisualizer() {
    viz = new window.Visamp.Visualizer($('viz'), { audioContext, onPresetChange });
    viz.connect(music.output);
    viz.setMaxFps(state.settings.visualizer.maxFps);
    viz.setReactivity(REVIEW ? 1 : state.settings.visualizer.reactivity);
    const last = state.settings.visualizer.lastPreset;
    if (!(last && viz.load(last, 0))) viz.next({ random: true, blendSeconds: 0 });
    viz.start();
    // Derezzede presets (D) vises ikke igen, favoritter (K) vises oftere; med "Use Peter's picks" også Peters.
    if (!REVIEW) applyPresetLists();
    // Blink-vagten: blinker et preset konstant (fx i en hurtig del), skiftes der videre. Ikke mens brugeren selv har
    // valgt med pilene, uden automatiske skift, eller i review-tilstanden, hvor blinkerne skal ses.
    flashGuard = new window.VisampFlashGuard.FlashGuard();
    viz.onLuma = (luma) => {
      if (REVIEW || autoHold || sleeping || presetListOpen() || !state.settings.visualizer.autoCycle) return;
      if (flashGuard.feed(nowSeconds(), luma)) {
        console.info('Flash guard: switching away from', viz.current);
        nextPreset();
      }
    };
    // Tron-laget ("tron" i Flynns terminal) ligger over visualiseringen og lytter til musikmotoren.
    tronOverlay = new window.Visamp.TronOverlay($('tron-overlay'));
    tronOverlay.setTheme(currentTheme());
    tronOverlay.setEnabled(false); // starter altid slukket; "tron" tænder det (huskes ikke, Peter 01-10-2026)
    // Ingen musik endnu: start i mørke, indtil musikmotoren hører lyd.
    setSleeping(true);
  }

  let tronOverlay = null;
  let flashGuard = null;
  let tronOn = false;
  function setTronOverlay(on) {
    tronOn = on;
    if (tronOverlay) tronOverlay.setEnabled(on);
  }

  // Review-tilstand (node scripts/start.js --review): kun de frasorterede presets, med navn; K beholder, D bandlyser.
  const REVIEW = new URLSearchParams(window.location.search).get('review') === '1';
  const reviewVotes = new Map();

  function onPresetChange(name) {
    saveSettingsSoon({ visualizer: { lastPreset: name } });
    markCurrentPreset();
    if (flashGuard) flashGuard.notifyChange(nowSeconds());
    if (REVIEW) {
      const vote = reviewVotes.get(name);
      showPresetName(`${viz.names.indexOf(name) + 1}/${viz.names.length}  ${name}${vote ? ` [${vote.toUpperCase()}]` : ''}`);
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(el);
    });
  }

  /**
   * K (kan lide) og D (derez) på det preset, der vises. I review-tilstanden går det videre i rækkefølge. Ellers
   * skjules et derezzet preset for brugeren selv, og stemmen sendes til Peter, hvis brugeren har sagt ja første
   * gang (src/main/votes.js). Fra kildekoden skriver hovedprocessen direkte i Peters ban- og behold-lister.
   */
  async function reviewVote(verdict) {
    if (!viz || !viz.current) return;
    const name = viz.current;
    if (REVIEW) {
      if (!reviewVotes.has(name)) await call(bridge.votes.add(name, verdict));
      reviewVotes.set(name, verdict);
      toast(t(verdict === 'keep' ? 'review.keep' : 'review.ban', { name }), 'info', 2500);
      viz.load(viz.sequentialName(1), 0); // videre i rækkefølge, så alle bliver set
      return;
    }
    await votePreset(name, verdict);
  }

  // De lister, der gælder nu: brugerens egne plus Peters, hvis det er slået til (presetLists i visualizer.js).
  let lists = { favorites: new Set(), hidden: new Set(), peterFav: new Set(), peterHidden: new Set() };

  function applyPresetLists() {
    const s = state.settings;
    lists = window.Visamp.presetLists({
      favorites: s.favoritePresets || [],
      hidden: s.hiddenPresets || [],
      exceptions: s.peterPickExceptions || [],
      peter: s.peterPicks ? window.gridPeterPicks : null,
    });
    viz.setHidden(lists.hidden);
    // Classic Winamp mode: kun MilkDrops egen pakke fra Winamp (winamp-classics.js, names).
    const classics = window.gridPresetsWinampClassics;
    viz.setOnly(s.classicMode && classics ? classics.names : null);
    viz.setFavorites(lists.favorites);
  }

  /** Står presettet på Peters liste (`favorites` eller `derez`), og bruges den? */
  function onPeterList(name, which) {
    const peter = state.settings.peterPicks && window.gridPeterPicks;
    return Boolean(peter && (peter[which] || []).includes(name));
  }

  /** Brugeren fortryder et af Peters valg for sig selv: huskes, så det ikke kommer igen med Peters liste. */
  function skipPeterPick(name) {
    const set = new Set(state.settings.peterPickExceptions || []);
    set.add(name);
    state.settings.peterPickExceptions = [...set];
    saveSettingsSoon({ peterPickExceptions: state.settings.peterPickExceptions });
  }

  function replaceRow(name) {
    const li = $('preset-list').querySelector(`li[data-name="${CSS.escape(name)}"]`);
    if (li) li.replaceWith(presetRow(name, lists.hidden.has(name)));
  }

  /** ↺ i preset-listen: et derezzet preset kommer tilbage. */
  function restorePreset(name) {
    if (!lists.peterHidden.has(name)) call(bridge.votes.add(name, 'clear')); // brugerens eget derez fortrudt
    if (onPeterList(name, 'derez')) skipPeterPick(name); // ellers ville Peters liste skjule det igen
    state.settings.hiddenPresets = (state.settings.hiddenPresets || []).filter((n) => n !== name);
    saveSettingsSoon({ hiddenPresets: state.settings.hiddenPresets });
    applyPresetLists();
    replaceRow(name);
    updatePresetCount();
    toast(t('presets.restored', { name }), 'info', 2500);
  }

  /** En stemme på et vilkårligt preset (D/K på det viste, eller × i preset-listen). Derez skjuler det for brugeren. */
  async function votePreset(name, verdict, { toggle = false } = {}) {
    if (state.info.packaged && state.settings.shareVotes == null) {
      // Første stemme: spørg, om stemmerne må sendes til Peter. Svaret huskes og kan ændres under Settings.
      const yes = window.confirm(t('votes.ask'));
      state.settings.shareVotes = yes;
      saveSettingsSoon({ shareVotes: yes });
    }
    if (verdict === 'keep') {
      // K gør presettet til favorit (personlig liste, vises oftere). Kun ☆/★ i preset-listen (toggle) kan fjerne
      // den igen (Peter 02-10-2026); så trækkes stemmen tilbage (clear).
      const favs = new Set(state.settings.favoritePresets || []);
      if (lists.favorites.has(name) && !toggle) {
        toast(t('votes.alreadyLiked', { name }), 'info', 2500);
        return;
      }
      const on = !lists.favorites.has(name);
      if (on) {
        favs.add(name);
        await call(bridge.votes.add(name, verdict));
      } else {
        // Brugerens egen favorit trækkes tilbage; står den også hos Peter, springes hans over for brugeren.
        if (!lists.peterFav.has(name)) await call(bridge.votes.add(name, 'clear'));
        favs.delete(name);
        if (onPeterList(name, 'favorites')) skipPeterPick(name);
      }
      state.settings.favoritePresets = [...favs];
      saveSettingsSoon({ favoritePresets: state.settings.favoritePresets });
      applyPresetLists();
      replaceRow(name);
      updatePresetCount();
      toast(t(on ? 'votes.liked' : 'votes.unliked', { name }), 'info', 2500);
      return;
    }
    await call(bridge.votes.add(name, verdict));
    if ((state.settings.favoritePresets || []).includes(name)) {
      state.settings.favoritePresets = state.settings.favoritePresets.filter((n) => n !== name);
      saveSettingsSoon({ favoritePresets: state.settings.favoritePresets });
    }
    const hidden = [...(state.settings.hiddenPresets || []), name];
    state.settings.hiddenPresets = hidden;
    saveSettingsSoon({ hiddenPresets: hidden });
    applyPresetLists();
    replaceRow(name);
    updatePresetCount();
    toast(t('votes.derezzed', { name }), 'info', 3000);
    // Hårdt klip: under en overgang er det nye preset allerede "det viste", så et D mere ville ramme et preset,
    // man knap har set (Peter 02-10-2026, tre D hurtigt efter hinanden).
    if (name === viz.current) nextPreset({ hardCut: true });
  }

  let presetNameTimer = null;
  /** Presettets navn vises kun, når brugeren selv skifter med pilene. */
  function showPresetName(name) {
    if (!name) return;
    const el = $('preset-name');
    el.textContent = name;
    el.classList.add('show');
    clearTimeout(presetNameTimer);
    presetNameTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function presetListOpen() {
    const el = document.getElementById('presets-dialog');
    return Boolean(el && el.open);
  }

  /** Pilene (taster og knapper): vælg selv, og sæt de automatiske skift på pause, til mellemrum trykkes. */
  let autoHold = false;
  function manualPreset(step) {
    if (step > 0) nextPreset({ showName: true });
    else prevPreset({ showName: true });
    if (!autoHold && state.settings.visualizer.autoCycle) {
      autoHold = true;
      toast(t('viz.autoPaused'), 'info', 4500);
    }
  }

  /** Mellemrum: næste preset, og de automatiske skift kører igen. */
  function spacePreset() {
    nextPreset();
    if (autoHold) {
      autoHold = false;
      director.schedule(nowSeconds(), directorConfig());
      toast(t('viz.autoResumed'), 'info', 3000);
    }
  }

  function directorConfig() {
    const v = state.settings.visualizer;
    const m = state.settings.music;
    return {
      // Har brugeren selv valgt med pilene, holder de automatiske skift pause, til der trykkes mellemrum.
      // Heller ikke mens preset-listen (L) er åben: den skal ikke skifte under én.
      autoCycle: v.autoCycle && !autoHold && !presetListOpen(),
      cycleSeconds: v.cycleSeconds,
      blendSeconds: v.blendSeconds,
      beatSync: m.beatSync,
      sectionChanges: m.sectionChanges,
      hardCuts: m.hardCuts,
    };
  }

  /** Vælger preset efter musikken lige nu: hvilke bånd der fylder, og hvor intens sangen er. */
  /** Valget af næste preset ud fra musikken, de målte presets og hvorfor der skiftes (se scorePreset). */
  function smartPick(reason = 'manual') {
    if (!state.settings.music.smartSelection) return null;
    return () => {
      const context = music.engine.selectionContext(reason, viz.current ? viz.profile(viz.current) : null);
      return viz.pickSmart((profile) => window.VisampMusic.scorePreset(profile, context));
    };
  }

  // Påskeægget "rinzler" gør næste automatiske skift til et hårdt klip.
  let rinzlerArmed = false;

  function nextPreset({ hardCut = false, showName = false } = {}) {
    if (!viz) return;
    const v = state.settings.visualizer;
    viz.next({ random: v.random, blendSeconds: hardCut ? 0 : v.blendSeconds, pick: smartPick() });
    director.notifyChange(nowSeconds(), directorConfig());
    if (showName) showPresetName(viz.current);
  }

  function prevPreset({ showName = false } = {}) {
    if (!viz) return;
    viz.previous({ blendSeconds: state.settings.visualizer.blendSeconds });
    director.notifyChange(nowSeconds(), directorConfig());
    if (showName) showPresetName(viz.current);
  }

  /** Automatisk skift fra instruktøren (takt, ny del, drop, nyt nummer). Navnet vises ikke. */
  function performAutoChange(action) {
    if (!viz) return;
    const hard = action.hard || rinzlerArmed;
    rinzlerArmed = false;
    if (hard && tronOverlay) tronOverlay.event('cut');
    if (hard && action.reason === 'drop') flashCut();
    if (!hard) viz.setNextTransition(transitionFor(action));
    viz.next({ random: state.settings.visualizer.random, blendSeconds: hard ? 0 : action.blendSeconds, pick: smartPick(action.reason) });
  }

  /**
   * Overgangen efter musikken (se installTransitions i visualizer.js): opbygningen fejer, en rolig del opløses som
   * plasma, en ny høj del (omkvædet) åbner sig fra midten; ellers fejning eller plasma. Med tempo går overgangen
   * i ryk på slagene. Overgangen varer hele takter (instruktørens blendFor), så slagene passer.
   */
  function transitionFor(action) {
    const s = music.engine.state;
    let pattern;
    if (action.reason === 'build') pattern = 1;
    else if (s.energy === 'low') pattern = 2;
    else if (action.reason === 'section' && s.energy === 'high') pattern = 3;
    else pattern = Math.random() < 0.5 ? 1 : 2;
    const beats =
      state.settings.music.beatSync && s.tempoValid && s.bpm ? Math.round((action.blendSeconds * s.bpm) / 60) : 0;
    return { pattern, beats: beats >= 2 ? beats : null };
  }

  /** Et kort lysglimt på et drop, så det hårde klip ser villet ud og ikke som en fejl. */
  function flashCut() {
    const el = $('cut-flash');
    el.classList.remove('on');
    void el.offsetWidth; // start animationen forfra
    el.classList.add('on');
  }

  function setVisualizerSetting(patch) {
    state.settings.visualizer = { ...state.settings.visualizer, ...patch };
    saveSettingsSoon({ visualizer: patch });
    renderVizToggles();
    director.schedule(nowSeconds(), directorConfig());
  }

  function setMusicSetting(patch) {
    state.settings.music = { ...state.settings.music, ...patch };
    saveSettingsSoon({ music: patch });
    music.setOptions({ agc: state.settings.music.agc, latencyMs: state.settings.music.latencyMs });
    renderVizToggles();
  }

  function renderVizToggles() {
    const v = state.settings.visualizer;
    const m = state.settings.music;
    $('viz-random').setAttribute('aria-pressed', String(v.random));
    $('viz-auto').setAttribute('aria-pressed', String(v.autoCycle));
    $('set-auto').checked = v.autoCycle;
    $('set-random').checked = v.random;
    $('set-cycle').value = String(v.cycleSeconds);
    $('set-blend').value = String(v.blendSeconds);
    $('set-max-fps').value = String(v.maxFps);
    $('set-reactivity').value = String(Math.round(v.reactivity * 100));
    // Tempo og reaktion (Peter 05-10-2026: "for kaotisk/for hurtigt" til en fest); se visualizer.js.
    if (viz) {
      viz.setMaxFps(v.maxFps);
      viz.setReactivity(REVIEW ? 1 : v.reactivity);
    }
    $('set-beatsync').checked = m.beatSync;
    $('set-sections').checked = m.sectionChanges;
    $('set-hardcuts').checked = m.hardCuts;
    $('set-smart').checked = m.smartSelection;
    $('set-agc').checked = m.agc;
    $('set-latency').value = String(m.latencyMs);
  }

  let sleeping = null;
  /** Ingen musik, intet billede: visualizeren fader til sort og stopper, indtil der spilles igen. */
  function setSleeping(asleep) {
    if (sleeping === asleep) return;
    sleeping = asleep;
    if (viz) viz.setAsleep(asleep);
    if (mini) mini.setMuted(asleep);
    if (tronOverlay) tronOverlay.setAsleep(asleep);
    $('viz-idle').classList.toggle('show', asleep);
  }

  let beatDot = null;
  let beatOffAt = 0;
  let lastQuickPoll = 0;
  let lastMusicLcd = 0;
  let pendingMusicEvents = [];

  /** Hvert billede: analysér lyden, lad instruktøren beslutte skift, og opdatér takt-lampen. */
  function musicLoop() {
    const now = nowSeconds();
    let events = state.capture.ok ? music.frame(now) : music.engine.update(now, SILENT_FRAME);
    // Tydelig lyd, mens Spotify sidst meldte pause: måske er der trykket afspil i Spotify selv.
    // Spørg med det samme i stedet for at vente op til 3 sekunder på næste opdatering.
    if (music.engine.playbackHint === false && music.lastRms > 0.01 && now - lastQuickPoll > 2) {
      lastQuickPoll = now;
      pollPlayback();
    }
    checkCaptureHealth(now);
    if (pendingMusicEvents.length) {
      events = events.concat(pendingMusicEvents);
      pendingMusicEvents = [];
    }
    for (const e of events) {
      if (e.type === 'beat' && drewShow) drewShow.beat(e);
      if (tronOverlay) {
        if (e.type === 'beat') tronOverlay.beat(e);
        else if (e.type === 'drop' || e.type === 'section') tronOverlay.event(e.type);
      }
      if (e.type === 'beat') {
        beatDot.classList.add('on');
        beatDot.classList.toggle('down', Boolean(e.downbeat));
        beatOffAt = now + 0.1;
      } else if (e.type === 'sleep') {
        setSleeping(true);
      } else if (e.type === 'wake') {
        setSleeping(false);
      }
    }
    if (now >= beatOffAt) beatDot.classList.remove('on', 'down');

    const engineState = music.engine.state;
    const action = director.update(now, events, engineState, directorConfig());
    if (action) performAutoChange(action);

    if (now - lastMusicLcd >= 0.25) {
      lastMusicLcd = now;
      $('lcd-bpm').textContent = engineState.bpm ? `${Math.round(engineState.bpm)} BPM` : '--- BPM';
      $('lcd-part').textContent = engineState.silent ? t('lcd.silent') : t('lcd.part', { n: engineState.sectionIndex });
    }
    requestAnimationFrame(musicLoop);
  }

  // ---------- Fuld skærm ----------

  // Hele siden går i fuld skærm, så introen, påskeæggene og beskeder stadig kan ses. CSS skjuler
  // alt andet end visualizeren (body.fullscreen) og knapperne; musen skjules, når den står stille.
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch((err) => reportError(err, 'fullscreen.failed'));
  }

  let cursorTimer = null;
  function wakeCursor() {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(cursorTimer);
    if (document.fullscreenElement) {
      cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), CURSOR_HIDE_MS);
    }
  }

  function onFullscreenChange() {
    const full = Boolean(document.fullscreenElement);
    document.body.classList.toggle('fullscreen', full);
    if (full) document.body.classList.add('cursor-hidden');
    else wakeCursor();
  }

  function showCurrentTitle() {
    const track = (state.playback && state.playback.item) || displayTracks()[state.selectedIndex];
    if (viz && track) viz.showTitle(F.trackLabel(track));
  }

  // ---------- Lydfangst ----------

  function setCaptureMessage(key, values = null) {
    state.captureMessage = { key, values };
    renderCaptureMessage();
  }

  function renderCaptureMessage() {
    const { key, values } = state.captureMessage;
    $('capture-message').textContent = t(key, values);
  }

  async function startCapture({ fromUser = false } = {}) {
    if (state.capture.ok) return true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      // Kun lyden bruges; videosporet (vores eget vindue) stoppes med det samme.
      stream.getVideoTracks().forEach((track) => track.stop());
      const track = stream.getAudioTracks()[0];
      if (!track) throw Object.assign(new Error(t('capture.noAudio')), { code: 'NO_AUDIO_TRACK' });
      track.addEventListener('ended', onCaptureEnded);
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      music.connect(source); // visualizer og mini-spektrum er koblet på music.output fra start
      state.capture = { ok: true, error: null, track, source, stream };
      $('capture-overlay').hidden = true;
      renderCaptureStatus();
      return true;
    } catch (err) {
      console.warn('Lydfangst fejlede:', err);
      state.capture = { ok: false, error: err.message || String(err), track: null, source: null, stream: null };
      if (fromUser) setCaptureMessage('capture.failed', { detail: err.message || String(err) });
      else setCaptureMessage('capture.clickToStart');
      $('capture-overlay').hidden = false;
      renderCaptureStatus();
      return false;
    }
  }

  function stopCapture() {
    const { track, source } = state.capture;
    if (track) {
      track.removeEventListener('ended', onCaptureEnded);
      track.stop();
    }
    if (source) {
      music.disconnect();
      try {
        source.disconnect();
      } catch {
        // Allerede frakoblet.
      }
    }
    state.capture = { ok: false, error: null, track: null, source: null, stream: null };
    renderCaptureStatus();
  }

  function onCaptureEnded() {
    stopCapture();
    setCaptureMessage('capture.ended');
    $('capture-overlay').hidden = false;
    setTimeout(() => startCapture(), 1500);
  }

  function renderCaptureStatus() {
    const device = state.outputDevice && state.outputDevice.name;
    $('capture-status').textContent = state.capture.ok
      ? t('capture.listeningOn', { device: device || state.capture.track.label || t('capture.systemAudio') })
      : t('capture.notListening') + (state.capture.error ? ` (${state.capture.error})` : '');
  }

  /** Starter lydfangsten forfra; en ny fangst lytter altid på Windows' nuværende standardenhed. */
  let restarting = null;
  function restartCapture() {
    if (restarting) return restarting;
    restarting = (async () => {
      stopCapture();
      await new Promise((resolve) => setTimeout(resolve, 600)); // lad Windows gøre skiftet færdigt
      return startCapture({ fromUser: true });
    })().finally(() => {
      restarting = null;
    });
    return restarting;
  }

  /** Fra hovedprocessen: Windows' standard-afspilningsenhed ved start og ved hvert skift. */
  async function onOutputDevice(device) {
    state.outputDevice = device;
    renderCaptureStatus();
    if (!device.changed) return;
    // Loopback bliver på den gamle enhed, så lydfangsten skal startes forfra på den nye.
    if (await restartCapture()) toast(t('capture.deviceSwitched', { device: device.name }));
  }

  /**
   * Sikkerhedsnet: Spotify melder, at der spilles på denne pc, men der er total stilhed i lydfangsten.
   * Start fangsten forfra én gang; hjælper det ikke, spiller Spotify sandsynligvis på en anden enhed.
   */
  let digitalSilenceSince = null;
  let lastRescue = -Infinity;
  let rescueHintShown = false;
  async function checkCaptureHealth(now) {
    const suspicious = state.capture.ok && music.engine.playbackHint === true && music.lastRms < 1e-5;
    if (!suspicious) {
      digitalSilenceSince = null;
      return;
    }
    if (digitalSilenceSince === null) digitalSilenceSince = now;
    if (now - digitalSilenceSince < 4 || restarting) return;
    digitalSilenceSince = null;
    if (now - lastRescue > 30) {
      lastRescue = now;
      await restartCapture();
      return;
    }
    if (!rescueHintShown) {
      rescueHintShown = true;
      const device = state.outputDevice && state.outputDevice.name ? ` (${state.outputDevice.name})` : '';
      toast(t('capture.silentWhilePlaying', { device }), 'error', 12000);
    }
  }

  // ---------- Spotify-status ----------

  async function refreshSpotifyStatus() {
    try {
      state.spotify = await call(bridge.spotify.status());
    } catch (err) {
      console.warn(err);
    }
    renderSpotifyStatus();
  }

  function renderSpotifyStatus() {
    const s = state.spotify;
    $('led-spotify').classList.toggle('on', s.loggedIn);
    $('led-api').classList.toggle('on', s.loggedIn && s.premium !== false);
    let status = !s.configured
      ? t('status.notConfigured')
      : s.loggedIn
        ? s.user
          ? t('status.loggedInAs', { name: s.user.displayName })
          : t('status.loggedIn')
        : t('status.notLoggedIn');
    if (s.configured && s.builtIn) status += ` · ${t('status.builtIn')}`;
    $('spotify-status').textContent = status;
    $('spotify-login').hidden = s.loggedIn;
    $('spotify-login').disabled = !s.configured || loggingIn;
    $('spotify-logout').hidden = !s.loggedIn;
    $('seek').disabled = !s.loggedIn;
    $('volume').disabled = !s.loggedIn;
    $('redirect-uri').textContent = s.redirectUri || state.settings.redirectUri || '';
    $('use-built-in').hidden = Boolean(state.settings.builtInClientId);
    // Uden Spotify visualiseres al lyd på pc'en, og musikmotoren finder selv nye numre (setAudioOnly).
    if (music && music.engine) music.engine.setAudioOnly(!s.loggedIn);
    if (!s.loggedIn) {
      state.playback = null;
      state.lastTrackId = null;
      $('lcd-device').textContent = '';
      if (music) music.engine.setPlaybackHint(null); // ingen Spotify-oplysninger: kun lyden afgør
    }
    if ($('guide-dialog').open) renderGuideLogin();
    renderCollection({ keepScroll: true });
  }

  // ---------- Playliste ----------

  function displayTracks() {
    const c = state.collection;
    if (!c) return [];
    return c.itemsRestricted ? state.queueTracks || [] : c.tracks;
  }

  /** Henter et Spotify-link. Returnerer true, hvis det lykkedes. */
  async function loadCollection(input, { quiet = false } = {}) {
    const text = String(input || '').trim();
    if (!text) {
      $('pl-input').focus();
      return false;
    }
    if (!state.spotify.loggedIn) {
      if (!quiet) {
        toast(t('load.needLogin'));
        openSettings();
      }
      return false;
    }
    state.loading = true;
    $('pl-load').disabled = true;
    $('pl-count').textContent = t('pl.loading');
    const unsubscribe = bridge.spotify.onLoadProgress(({ loaded, total }) => {
      $('pl-count').textContent = total ? t('pl.loadingProgress', { loaded, total }) : t('pl.loadingCount', { loaded });
    });
    try {
      const collection = await call(bridge.spotify.loadCollection(text));
      state.collection = collection;
      state.queueTracks = null;
      state.selectedIndex = collection.tracks.length ? 0 : -1;
      $('pl-input').value = text;
      renderCollection();
      if (collection.itemsRestricted && state.playback && state.playback.contextUri === collection.uri) refreshQueue();
      return true;
    } catch (err) {
      if (!quiet) reportError(err, 'load.failed');
      else console.warn('Could not load the last playlist:', err);
      return false;
    } finally {
      unsubscribe();
      state.loading = false;
      $('pl-load').disabled = false;
      renderCounts();
    }
  }

  function renderCollection({ keepScroll = false } = {}) {
    const c = state.collection;
    const tracks = displayTracks();

    $('pl-meta').hidden = !c;
    if (c) {
      $('pl-name').textContent = c.name;
      const kind = I18N.has(`pl.kind.${c.type}`) ? t(`pl.kind.${c.type}`) : '';
      $('pl-owner').textContent = [kind, c.owner].filter(Boolean).join(' · ');
      const cover = $('pl-cover');
      cover.hidden = !c.imageUrl;
      if (c.imageUrl && cover.src !== c.imageUrl) cover.src = c.imageUrl;
    }

    const restricted = Boolean(c && c.itemsRestricted);
    $('pl-notice').hidden = !restricted;
    if (restricted) $('pl-notice-text').textContent = t(state.queueTracks ? 'pl.restricted.queue' : 'pl.restricted');

    list.setTracks(tracks, { selected: Math.max(0, state.selectedIndex), keepScroll });
    if (tracks.length === 0) state.selectedIndex = -1;
    else state.selectedIndex = list.selected;
    list.setCurrent(findCurrentIndex());

    const empty = tracks.length === 0;
    $('pl-list').hidden = empty;
    $('pl-empty').hidden = !empty;
    if (empty) renderEmptyState();
    renderCounts();
  }

  function renderEmptyState() {
    const s = state.spotify;
    const action = $('pl-empty-action');
    let text;
    let actionLabel = null;
    if (state.collection && state.collection.itemsRestricted) {
      text = t('pl.empty.restricted');
    } else if (state.collection) {
      text = t('pl.empty.none');
    } else if (!s.configured) {
      text = t('pl.empty.notConfigured');
      actionLabel = t('pl.empty.connect');
    } else if (!s.loggedIn) {
      text = t('pl.empty.notLoggedIn');
      actionLabel = t('pl.empty.login');
    } else {
      text = t('pl.empty.ready');
    }
    $('pl-empty-text').textContent = text;
    action.hidden = !actionLabel;
    if (actionLabel) action.textContent = actionLabel;
  }

  function renderCounts() {
    if (state.loading) return;
    const c = state.collection;
    const tracks = displayTracks();
    if (!c) {
      $('pl-count').textContent = '';
      $('pl-total').textContent = '';
      return;
    }
    const total = c.itemsRestricted ? c.total : tracks.length;
    $('pl-count').textContent = total ? (total === 1 ? t('pl.count.one') : t('pl.count.many', { n: total })) : '';
    const duration = F.totalDuration(tracks);
    $('pl-total').textContent = c.itemsRestricted
      ? tracks.length
        ? t('pl.queueTotal', { n: tracks.length })
        : ''
      : t('pl.total', { n: tracks.length, time: F.formatTime(duration) });
  }

  function findCurrentIndex() {
    const item = state.playback && state.playback.item;
    if (!item || !item.id) return -1;
    return displayTracks().findIndex((track) => track.id === item.id);
  }

  async function refreshQueue() {
    try {
      const queue = await call(bridge.spotify.queue());
      state.queueTracks = [queue.currentlyPlaying, ...queue.queue].filter(Boolean);
      renderCollection({ keepScroll: true });
    } catch (err) {
      console.warn('Could not load the queue:', err);
    }
  }

  // ---------- Afspilning ----------

  function playbackMode() {
    const pb = state.playback;
    if (!pb || !pb.item || state.stopped) return 'stopped';
    return pb.isPlaying ? 'playing' : 'paused';
  }

  let pollTimers = [];
  function schedulePoll(ms) {
    pollTimers.push(setTimeout(pollPlayback, ms));
    if (pollTimers.length > 8) pollTimers.shift();
  }

  async function pollPlayback() {
    if (!state.spotify.loggedIn || document.hidden) return;
    try {
      applyPlayback(await call(bridge.spotify.playbackState()));
    } catch (err) {
      if (['NOT_LOGGED_IN', 'INVALID_CLIENT'].includes(err.code)) refreshSpotifyStatus();
      else if (!['NETWORK', 'RATE_LIMITED', 'QUOTA_EXCEEDED'].includes(err.code)) console.warn('Afspillerstatus:', err);
    }
  }

  // Playlister og albums, der ikke kunne hentes (fx Spotifys egne playlister, som 2026-reglerne spærrer): prøves
  // ikke igen ved hver afspillerstatus.
  const followFailed = new Set();

  /**
   * Spiller Spotify en anden playliste eller et andet album end det viste, hentes det af sig selv (Peter
   * 05-10-2026). Kun playlister og albums; kunstnere, "Liked Songs" og podcasts har ingen liste at vise her.
   */
  let lastSpotifyContext = null;
  function followSpotifyContext(pb, { force = false } = {}) {
    if (state.settings.followSpotify === false || !pb || !pb.contextUri || state.loading) return;
    // Kun når Spotify skifter til noget andet: har brugeren selv indsat et link, mens Spotify spiller det gamle,
    // bliver det stående.
    if (!force && pb.contextUri === lastSpotifyContext) return;
    lastSpotifyContext = pb.contextUri;
    const parts = pb.contextUri.split(':');
    const type = parts[parts.length - 2];
    const id = parts[parts.length - 1];
    if (!['playlist', 'album'].includes(type) || !id) return;
    if (state.collection && state.collection.uri === pb.contextUri) return;
    if (followFailed.has(pb.contextUri)) return;
    const link = `https://open.spotify.com/${type}/${id}`;
    loadCollection(link, { quiet: true }).then((ok) => {
      if (!ok) {
        followFailed.add(pb.contextUri);
        return;
      }
      saveSettingsSoon({ lastInput: link });
      toast(t('pl.followed', { name: state.collection.name }), 'info', 2500);
    });
  }

  function applyPlayback(pb) {
    state.playback = pb;
    state.playbackReceivedAt = performance.now();
    // Spotify afgør, om der er musik: spiller den her, vises alt; ellers vækker kun tydelig lyd billedet.
    music.engine.setPlaybackHint(Boolean(pb && pb.isPlaying && pb.device && pb.device.isThisComputer));
    const item = pb && pb.item;
    if (item && item.id !== state.lastTrackId) {
      const firstSeen = state.lastTrackId === null;
      state.lastTrackId = item.id;
      if (viz) viz.showTitle(F.trackLabel(item)); // som MilkDrop, når et nyt nummer starter
      if (!firstSeen) {
        // Nyt nummer: musikmotoren glemmer den forrige sang, og instruktøren skifter på takten.
        music.engine.notifyTrackChange(nowSeconds());
        pendingMusicEvents.push({ type: 'track', t: nowSeconds() });
      }
      const c = state.collection;
      if (c && c.itemsRestricted && pb.contextUri === c.uri) refreshQueue();
    }
    if (pb && pb.isPlaying) state.stopped = false;
    followSpotifyContext(pb);
    list.setCurrent(findCurrentIndex());

    const device = pb && pb.device;
    $('lcd-device').textContent = device ? `${device.name}${device.type ? ` · ${device.type}` : ''}` : '';
    const volume = $('volume');
    if (device && !state.volumeDragging) {
      volume.disabled = !device.supportsVolume;
      if (Number.isFinite(device.volumePercent)) {
        state.spotifyVolume = device.volumePercent; // Init følger Spotifys lydstyrke (initVolume)
        volume.value = String(device.volumePercent);
        setSliderFill(volume, device.volumePercent);
      }
    }
  }

  function currentProgressMs() {
    const pb = state.playback;
    if (!pb || !pb.item || state.stopped) return 0;
    const extra = pb.isPlaying ? performance.now() - state.playbackReceivedAt : 0;
    return Math.min(pb.item.durationMs || Number.MAX_SAFE_INTEGER, pb.progressMs + extra);
  }

  async function control(action) {
    const res = await call(bridge.spotify.control(action));
    if (action === 'stop') state.stopped = true;
    if (action === 'play' || action === 'restart') state.stopped = false;
    if (res.mode === 'mediakey' && !mediaKeyHintShown) {
      mediaKeyHintShown = true;
      toast(t(state.spotify.loggedIn ? 'mediakey.loggedIn' : 'mediakey.loggedOut'));
    }
    schedulePoll(350);
    schedulePoll(1500);
    return res;
  }

  async function doPlay() {
    const pb = state.playback;
    const selected = displayTracks()[state.selectedIndex];
    if (pb && pb.item && !state.stopped) {
      if (pb.isPlaying) return control('restart'); // Winamp: Afspil under afspilning starter nummeret forfra
      if (!selected || state.selectedIndex === findCurrentIndex()) return control('play');
    }
    if (selected) return playTrack(state.selectedIndex);
    return control('play');
  }

  async function transport(action) {
    try {
      if (action === 'play') await doPlay();
      else if (action === 'pause') await control('toggle');
      else if (action === 'stop') await control('stop');
      else if (action === 'prev') await control('previous');
      else if (action === 'next') await control('next');
    } catch (err) {
      reportError(err, 'play.noResponse');
    }
  }

  async function playTrack(index) {
    const tracks = displayTracks();
    const track = tracks[index];
    if (!track) return;
    list.select(index, { notify: false });
    state.selectedIndex = index;
    if (!track.playable || !track.uri) {
      toast(t('play.cantPlay'));
      return;
    }
    const c = state.collection;
    let target;
    if (c && c.uri && c.type !== 'track' && !c.itemsRestricted) {
      // Startnummeret angives med URI: Spotifys afspiller springer numre over, der ikke længere findes, når den
      // tæller positioner, så efter et forsvundet nummer ramte positionen nummeret nedenunder (01-10-2026).
      // Står nummeret flere gange i playlisten, er URI'en tvetydig; så bruges positionen.
      const copies = (c.tracks || []).filter((x) => x.uri === track.uri).length;
      target = copies > 1 ? { contextUri: c.uri, position: track.position, trackUri: track.uri } : { contextUri: c.uri, trackUri: track.uri };
    } else if (c && c.uri && c.itemsRestricted) {
      target = { contextUri: c.uri, trackUri: track.uri };
    } else {
      // Et enkelt nummer afspilles i sit albums kontekst (se buildPlayRequest i src/main/playback.js).
      target = { trackUri: track.uri, parentUri: track.parentUri };
    }
    try {
      const res = await call(bridge.spotify.play(target));
      state.stopped = false;
      if (res.reason === 'APP_IGNORED_COMMAND') toast(t('play.appIgnored'), 'info', 7000);
      else if (res.reason === 'PREMIUM_REQUIRED') toast(t('play.premium'), 'info', 7000);
      else if (res.mode === 'external') toast(t('play.external'), 'info', 6000);
      schedulePoll(400);
      schedulePoll(1600);
    } catch (err) {
      reportError(err, 'play.failed');
    }
  }

  async function playWholeContext() {
    const c = state.collection;
    if (!c || !c.uri) return;
    try {
      await call(bridge.spotify.play({ contextUri: c.uri }));
      state.stopped = false;
      schedulePoll(500);
      setTimeout(refreshQueue, 1500);
    } catch (err) {
      reportError(err, 'play.contextFailed');
    }
  }

  function setSliderFill(slider, percent) {
    slider.style.setProperty('--pct', `${Math.max(0, Math.min(100, percent))}%`);
  }

  // ---------- LCD ----------

  let marqueeChars = 30;
  let marqueeOffset = 0;
  let marqueeSourceText = '';
  let lastMarqueeStep = 0;

  function measureMarquee() {
    const el = $('marquee');
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${getComputedStyle(el).fontSize} VT323`;
    const charWidth = ctx.measureText('0000000000').width / 10 || 10;
    marqueeChars = Math.max(8, Math.floor(el.clientWidth / charWidth));
  }

  function marqueeSource() {
    if (state.loadingText) return state.loadingText;
    const item = state.playback && state.playback.item;
    if (item) {
      const index = findCurrentIndex();
      return F.marqueeText(item, index >= 0 ? index + 1 : undefined);
    }
    const selected = displayTracks()[state.selectedIndex];
    if (selected) return F.marqueeText(selected, state.selectedIndex + 1);
    return t('marquee.welcome');
  }

  function lcdTick() {
    const mode = playbackMode();
    $('state-icon').dataset.state = mode;

    const item = state.playback && state.playback.item;
    const progress = currentProgressMs();
    const duration = item ? item.durationMs : 0;
    const remaining = state.settings.clockMode === 'remaining' && duration;
    $('clock').textContent = F.formatClock(remaining ? duration - progress : progress, remaining);

    const seek = $('seek');
    if (!state.seeking) {
      const fraction = duration ? progress / duration : 0;
      seek.value = String(Math.round(fraction * 1000));
      setSliderFill(seek, fraction * 100);
    }

    const text = marqueeSource();
    if (text !== marqueeSourceText) {
      marqueeSourceText = text;
      marqueeOffset = 0;
    }
    const now = performance.now();
    if (now - lastMarqueeStep >= MARQUEE_STEP_MS) {
      lastMarqueeStep = now;
      if (text.length > marqueeChars) marqueeOffset += 1;
    }
    $('marquee').textContent = F.marqueeFrame(text, marqueeOffset, marqueeChars);

    // Lyser kun, når musikmotoren hører musik; svag baggrundslyd tæller ikke.
    $('led-audio').classList.toggle('on', state.capture.ok && !music.engine.silent);
  }

  // ---------- Intro ----------

  let intro = null;

  /** Lyscyklerne kæmper og skriver teksten. Uden linjer (Konami-koden) er det kun kamp. */
  /**
   * To intro-stilarter (Settings → Intro): 'war' er den lange kamp, hvor teksten skrives midt i kampen
   * (intro-war.js), 'duel' er kampen efterfulgt af duellen, der skriver teksten (intro.js).
   */
  function playIntro(opts = {}) {
    if (intro && intro.running) return Promise.resolve({ skipped: true });
    const style = opts.style || state.settings.introStyle || 'war';
    const Intro = style === 'duel' ? window.Visamp.GridIntro : window.Visamp.GridIntroWar;
    // "Init" fra 12 s: opbygningen under kampen, og det hårde sæt kommer, når de to sidste kæmper.
    const track = state.settings.introMusic !== false ? playInit({ from: 12 }) : null;
    return new Promise((resolve) => {
      intro = new Intro($('intro'), $('intro-canvas'), {
        ...opts,
        theme: currentTheme(),
        onDone: (info) => {
          if (track) track.stop(info && info.skipped ? 0.5 : 1.4);
          resolve(info);
        },
      });
      intro.start();
    });
  }

  // ---------- Musik: "Init" af Nine Inch Nails (TRON: Ares) ----------

  const INIT_TRACK = 'media/init.mp3';

  /** Glider lydstyrken til `to` over `seconds`. */
  function fadeAudio(audio, to, seconds) {
    return new Promise((resolve) => {
      const from = audio.volume;
      const start = performance.now();
      const step = (now) => {
        // requestAnimationFrames tidsstempel kan ligge lidt før performance.now(); uden klemning giver det
        // en negativ lydstyrke, som kaster en fejl og efterlader musikken på lydstyrke 0 (30-09-2026).
        const f = Math.max(0, Math.min(1, (now - start) / 1000 / Math.max(seconds, 0.01)));
        audio.volume = Math.max(0, Math.min(1, from + (to - from) * f));
        if (f < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * Spiller Init fra `from` sekunder, eventuelt i løkke mellem loop[0] og loop[1]. Returnerer { stop(sekunder) }.
   * Selvtesten spiller den ikke (den laver sin egen testlyd).
   */
  // Init er mastret meget højt (NIN), mens Spotify udjævner lydstyrken (ca. -14 LUFS) og har sin egen
  // lydstyrkeskyder. Uden justering bragede Init igennem (Peter 02-10-2026). Init spilles derfor ved Spotifys
  // lydstyrke, trukket ca. 6 dB ned, gange brugerens indstilling (100 % = som Spotify).
  // 0,5 var stadig for højt (Peter 02-10-2026: "take the intro down to 40"): 0,5 × 0,4 = 0,2.
  const INIT_LOUDNESS_TRIM = 0.2;
  const INIT_FALLBACK_SPOTIFY = 0.6; // Spotifys lydstyrke kendes ikke (ikke logget ind, ingen afspiller)

  function initVolume() {
    const spotify = Number.isFinite(state.spotifyVolume) ? state.spotifyVolume / 100 : INIT_FALLBACK_SPOTIFY;
    const user = Number.isFinite(state.settings.initVolume) ? state.settings.initVolume : 1;
    return Math.max(0, Math.min(1, INIT_LOUDNESS_TRIM * spotify * user));
  }

  function playInit({ from = 0, loop = null, volume: wanted = null, force = false, onEnded = null } = {}) {
    const base = wanted === null ? initVolume() : wanted;
    const volume = state.info && state.info.quiet ? base * 0.03 : base; // selvtest med --quiet
    if (state.info.selftest && !force) return { stop() {}, time: () => null, duration: () => null };
    const audio = new Audio(`${INIT_TRACK}#t=${from}`);
    audio.volume = 0;
    if (loop) {
      audio.addEventListener('timeupdate', () => {
        if (audio.currentTime >= loop[1]) audio.currentTime = loop[0];
      });
    }
    if (onEnded) audio.addEventListener('ended', onEnded);
    audio.play().catch((err) => console.warn('Init kunne ikke afspilles:', err));
    fadeAudio(audio, volume, 0.8);
    let stopped = false;
    return {
      time: () => (audio.readyState >= 2 && !audio.paused ? audio.currentTime : null),
      duration: () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null),
      debug: () => ({
        paused: audio.paused,
        currentTime: Math.round(audio.currentTime * 100) / 100,
        readyState: audio.readyState,
        volume: Math.round(audio.volume * 10000) / 10000, // 4 decimaler: den stille selvtest ligger på ca. 0,002
        error: audio.error ? audio.error.code : null,
        src: audio.currentSrc,
      }),
      stop(seconds = 1) {
        if (stopped) return;
        stopped = true;
        fadeAudio(audio, 0, seconds).then(() => {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        });
      },
    };
  }

  // ---------- Påskeæg ----------

  // Hvert påskeæg er en lille animation i #egg. showEgg returnerer et løfte, der indfries, når animationen
  // er færdig eller sprunget over (tast eller klik), så Flynns terminal ved, hvornår den skal komme tilbage.
  let stopEgg = null;

  /** Skriver tekst ind tegn for tegn, som på en terminal i filmen. */
  function typeInto(el, text, perSecond, timers) {
    el.textContent = '';
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(id);
    }, 1000 / perSecond);
    timers.push(id);
  }

  /**
   * @param {string} kind  styrer udseendet (CSS: .egg[data-kind=...])
   * @param {object} o
   *   text, sub   stor tekst og undertekst
   *   typed       skriv teksten ind tegn for tegn (tegn pr. sekund)
   *   lines       flere linjer, der skrives ind en ad gangen (ENCOM-opstart)
   *   art         CSS-klasse til grafikken (disc, diamond, star, sweep, halo)
   *   video       sti til en video, der afspilles `loops` gange i stedet for en fast varighed
   *   ms          varighed
   *   at          [[ms, fn], ...] ting, der skal ske undervejs
   */
  function showEgg(kind, o = {}) {
    if (stopEgg) stopEgg(true);
    return new Promise((resolve) => {
      const el = $('egg');
      const text = $('egg-text');
      const sub = $('egg-sub');
      const art = $('egg-art');
      const video = $('egg-video');
      const timers = [];
      el.dataset.kind = kind;
      art.className = `egg-art${o.art ? ` ${o.art}` : ''}`;
      sub.textContent = o.sub || '';
      text.textContent = o.typed || o.lines ? '' : o.text || '';
      video.hidden = !o.video;
      el.hidden = false;
      el.classList.remove('show', 'leaving');
      void el.offsetWidth; // start CSS-animationerne forfra
      el.classList.add('show');

      if (o.typed) typeInto(text, o.text || '', o.typed, timers);
      if (o.lines) {
        let delay = 0;
        o.lines.forEach((line, i) => {
          timers.push(
            setTimeout(() => {
              text.textContent += (i ? '\n' : '') + line;
            }, delay)
          );
          delay += o.lineMs || 420;
        });
      }
      for (const [ms, fn] of o.at || []) timers.push(setTimeout(fn, ms));

      let done = false;
      const finish = (immediately = false) => {
        if (done) return;
        done = true;
        stopEgg = null;
        timers.forEach((id) => {
          clearTimeout(id);
          clearInterval(id);
        });
        window.removeEventListener('keydown', onKey, true);
        el.removeEventListener('click', onClick);
        video.onended = null;
        video.pause();
        el.classList.remove('show');
        el.classList.add('leaving');
        setTimeout(() => {
          if (stopEgg) return; // et nyt påskeæg har overtaget
          el.hidden = true;
          el.classList.remove('leaving');
          video.removeAttribute('src');
          video.load();
        }, immediately ? 0 : 320);
        setTimeout(resolve, immediately ? 0 : 320);
      };
      const onKey = (event) => {
        event.stopPropagation();
        event.preventDefault();
        finish();
      };
      const onClick = () => finish();
      window.addEventListener('keydown', onKey, true);
      el.addEventListener('click', onClick);
      stopEgg = finish;

      if (o.video) {
        let plays = 0;
        video.src = o.video;
        video.onended = () => {
          plays += 1;
          if (plays >= (o.loops || 1)) finish();
          else {
            video.currentTime = 0;
            video.play().catch(() => finish());
          }
        };
        video.play().catch(() => finish());
        timers.push(setTimeout(finish, 20000)); // sikkerhedsnet
      } else {
        timers.push(setTimeout(finish, o.ms || 2600));
      }
    });
  }

  // ---------- Påskeægget "drew" ----------

  let drewShow = null;

  /** Hvor kraftig musikken er lige nu (0..1), ud fra den rå lyd. */
  function musicLevel() {
    if (!music || !state.capture.ok) return 0;
    const db = 20 * Math.log10(Math.max(music.lastRms, 1e-6));
    return Math.max(0, Math.min(1, (db + 45) / 35));
  }

  function runDrew(opts = {}) {
    if (stopEgg) stopEgg(true);
    return new Promise((resolve) => {
      // Alle drew.lineN i i18n.js, i nummerorden (så nye linjer bare skal tilføjes dér).
      const lines = I18N.numbered('drew.line');
      const trackRef = {};
      drewShow = new window.Visamp.DrewShow($('drew'), {
        canvas: $('drew-canvas'),
        stage: document.querySelector('#drew .drew-stage'),
        trackTime: () => (trackRef.track ? trackRef.track.time() : null),
        songLength: () => (trackRef.track ? trackRef.track.duration() : null),
        beatMap: window.Visamp.INIT_BEATS,
        debugTrack: () => (trackRef.track && trackRef.track.debug ? trackRef.track.debug() : null),
        timeOffset: opts.timeOffset || 0,
        img: $('drew-img'),
        placeholder: $('drew-placeholder'),
        title: $('drew-title'),
        sub: $('drew-sub'),
        lines,
        level: musicLevel,
        sources: ['media/drew.png', 'media/drew.jpg', 'media/drew.jpeg', 'media/drew.webp'],
      });
      drewShow.start();
      // Init fra begyndelsen til enden. Spiller Spotify, holder den pause imens.
      const spotifyWasPlaying = Boolean(state.playback && state.playback.isPlaying && !state.stopped);
      if (spotifyWasPlaying) control('toggle').catch(() => {});
      // Hele sangen; showet slutter, når den er færdig.
      const track = playInit({ from: 0, force: opts.forceMusic, onEnded: () => finish() });
      trackRef.track = track;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener('keydown', onKey, true);
        $('drew').removeEventListener('click', finish);
        if (drewShow) drewShow.stop();
        drewShow = null;
        track.stop(0.6);
        if (spotifyWasPlaying) setTimeout(() => control('toggle').catch(() => {}), 650);
        setTimeout(resolve, 350);
      };
      const onKey = (event) => {
        event.stopPropagation();
        event.preventDefault();
        finish();
      };
      window.addEventListener('keydown', onKey, true);
      $('drew').addEventListener('click', finish);
    });
  }

  /** Kører et påskeæg. Returnerer et løfte, der indfries, når det er færdigt, eller false for et ukendt navn. */
  function runEgg(name) {
    switch (name) {
      case 'flynn':
        return playIntro({ style: 'war', lines: ['FLYNN', 'LIVES'], cycles: 10, duelAt: 7 });
      case 'battle':
        // Game Grid: kun kamp, til ét hold står tilbage som vinder.
        toast(t('egg.konami'));
        return playIntro({
          style: 'war',
          lines: [],
          cycles: 16,
          battleSeconds: 16,
          winnerText: (name) => (name ? { title: t(`battle.win.${name}`), sub: t(`battle.win.${name}.sub`) } : { title: t('battle.draw'), sub: '' }),
        });
      case 'blue':
        // "tron": tilbage til det blå Tron-tema.
        setTheme('grid');
        toast(t('term.tronBlue'));
        return Promise.resolve(true);
      case 'overlay': {
        // "tron": Tron-laget over visualiseringen til og fra (også i terminalen, se termRun).
        const on = !tronOn;
        setTronOverlay(on);
        toast(t(on ? 'term.tron.on' : 'term.tron.off'));
        return Promise.resolve(true);
      }
      case 'epic':
        // "epic battle" (link-feltet eller Flynns terminal): Game Grid med 40 cykler i en større arena (finere gitter), ca. 1 minut.
        toast(t('egg.epic'));
        return playIntro({
          style: 'war',
          lines: [],
          cycles: 40,
          gridCells: 90,
          battleSeconds: 45,
          winnerText: (name) => (name ? { title: t(`battle.win.${name}`), sub: t(`battle.win.${name}.sub`) } : { title: t('battle.draw'), sub: '' }),
        });
      case 'clu': {
        // Clus hær fejer hen over the Grid; temaet skifter, mens fejningen dækker skærmen.
        const toClu = currentTheme() !== 'clu';
        return showEgg(toClu ? 'clu' : 'users-back', {
          text: t(toClu ? 'egg.clu.big' : 'egg.clu.off.big'),
          sub: t(toClu ? 'egg.clu' : 'egg.clu.off'),
          art: 'sweep',
          ms: 3000,
          at: [[650, () => setTheme(toClu ? 'clu' : 'grid')]],
        });
      }
      case 'mcp':
        return showEgg('mcp', { text: t('egg.mcp'), ms: 2600 });
      case 'bit': {
        const yes = Math.random() < 0.5;
        return showEgg(yes ? 'bit-yes' : 'bit-no', { text: t(yes ? 'egg.bit.yes' : 'egg.bit.no'), art: yes ? 'diamond' : 'star', ms: 1900 });
      }
      case 'derez':
        nextPreset({ hardCut: true });
        return showEgg('derez', { text: t('egg.derez'), ms: 1500 });
      case 'rinzler':
        rinzlerArmed = true;
        return showEgg('rinzler', { text: t('egg.rinzler.name'), sub: t('egg.rinzler'), art: 'disc', ms: 2800 });
      case 'users':
        // Tron kaster sin identitetsdisk.
        return showEgg('users', { text: t('egg.users'), art: 'disc', typed: 22, ms: 3400 });
      case 'greetings':
        return showEgg('greetings', { text: t('egg.greetings'), typed: 14, ms: 3000 });
      case 'encom':
        return showEgg('encom', {
          lines: [t('egg.encom.boot1'), t('egg.encom.boot2'), t('egg.encom.boot3'), t('egg.encom.boot4'), '', t('egg.encom')],
          lineMs: 480,
          ms: 4300,
        });
      case 'zen':
        // Flynns hvide, stille tilflugtssted.
        return showEgg('zen', { text: t('egg.zen'), art: 'halo', ms: 4200 });
      case 'jazz':
        return showEgg('jazz', { video: 'media/biojazz.mp4', loops: 3, sub: t('egg.jazz') });
      case 'terminal':
        openTerminal();
        return Promise.resolve();
      case 'drew':
        return runDrew();
      case 'spaces':
        // "who am i" med mellemrum: Bits røde NEJ og en syntaksfejl.
        // 8 s: undertekstens ca. 20 ord skal kunne nås (4,2 s var for kort, Peter 01-10-2026). Tast eller klik lukker.
        return showEgg('spaces', { text: t('egg.spaces'), sub: t('egg.spaces.sub'), art: 'star', ms: 8000 });
      default:
        return false;
    }
  }

  // ---------- Flynns terminal og snydearket ----------

  // Som i Tron: Legacy, hvor Sam finder Flynns terminal i kælderen under arkadehallen og skriver whoami.
  let termQueue = Promise.resolve();
  const termHistory = [];
  let termHistoryIndex = 0;

  function openTerminal() {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('term-output').textContent = '';
    $('term-input').value = '';
    $('terminal-dialog').showModal();
    $('term-input').focus();
    termPrint([t('term.boot'), t('term.lastLogin'), '', '$ whoami', t('term.whoami'), '', t('term.hint')]);
  }

  /** Tilbage i terminalen efter et påskeæg, med det hele stående som før. */
  function returnToTerminal(cmd) {
    if (!$('terminal-dialog').open) $('terminal-dialog').showModal();
    $('term-input').value = '';
    $('term-input').focus();
    termPrint([t('term.returned', { cmd })]);
  }

  /** Skriver linjer én ad gangen, som en gammel terminal. */
  function termPrint(lines) {
    const out = $('term-output');
    termQueue = termQueue.then(async () => {
      for (const line of lines) {
        out.textContent += `${line}\n`;
        out.scrollTop = out.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 28));
      }
    });
    return termQueue;
  }

  function cheatSheetLines() {
    // Ord til link-feltet i én tabel; Konami-koden og musetricket for sig, da pilene ikke er lige brede.
    const rows = window.Visamp.EGG_CHEAT_SHEET;
    const typed = rows.filter((row) => row[2] && row[3] !== 'terminal');
    const terminalOnly = rows.filter((row) => row[3] === 'terminal');
    const other = rows.filter((row) => !row[2]);
    const width = Math.max(...typed.map(([input]) => input.length), ...terminalOnly.map(([input]) => input.length)) + 3;
    return [
      t('sheet.title'),
      '',
      ...typed.map(([input, key]) => `  ${input.padEnd(width)}${t(key)}`),
      ...(terminalOnly.length ? ['', t('sheet.terminal'), '', ...terminalOnly.map(([input, key]) => `  ${input.padEnd(width)}${t(key)}`)] : []),
      '',
      t('sheet.anywhere'),
      '',
      ...other.flatMap(([input, key]) => [`  ${input}`, `      ${t(key)}`]),
    ];
  }

  function termRun(raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    termHistory.push(cmd);
    termHistoryIndex = termHistory.length;
    termPrint([`$ ${cmd}`]);
    const [name, ...args] = cmd.split(/\s+/);
    switch (name.toLowerCase()) {
      case 'whoami':
        termPrint([t('term.whoami')]);
        break;
      case 'help':
      case '?':
        termPrint([t('term.help')]);
        break;
      case 'ls':
      case 'dir':
        termPrint([t('term.ls')]);
        break;
      case 'uname':
        termPrint([t('term.uname')]);
        break;
      case 'tron':
        // Temaet blåt (også fra link-feltet).
        setTheme('grid');
        termPrint([t('term.tronBlue')]);
        break;
      case 'trongrid': {
        // Tron-laget over visualiseringen, til og fra (også fra link-feltet). Huskes ikke: det starter slukket.
        const on = !tronOn;
        setTronOverlay(on);
        termPrint([t(on ? 'term.tron.on' : 'term.tron.off')]);
        break;
      }
      case 'epic':
        if ((args[0] || '').toLowerCase() !== 'battle') {
          termPrint([t('term.notFound', { cmd: name })]);
          break;
        }
        termPrint([t('term.running', { cmd: 'epic battle' })]).then(async () => {
          $('terminal-dialog').close();
          await runEgg('epic');
          returnToTerminal('epic battle');
        });
        break;
      case 'clear':
      case 'cls':
        termQueue = termQueue.then(() => {
          $('term-output').textContent = '';
        });
        break;
      case 'exit':
      case 'logout':
      case 'quit':
        termPrint([t('term.bye')]).then(() => setTimeout(() => $('terminal-dialog').close(), 400));
        break;
      case 'cat':
      case 'type':
      case 'more': {
        const file = (args[0] || '').toLowerCase();
        if (file === 'easter_eggs.txt') termPrint(cheatSheetLines());
        else if (file === 'readme.txt') termPrint([t('term.readme')]);
        else termPrint([t('term.noFile', { file: args[0] || '' })]);
        break;
      }
      default: {
        // Et påskeæg-ord virker også herfra.
        const egg = eggs.command(cmd);
        if (egg && egg !== 'terminal') {
          const program = name.toLowerCase();
          termPrint([t('term.running', { cmd: program })]).then(async () => {
            $('terminal-dialog').close();
            await runEgg(egg);
            returnToTerminal(program);
          });
        } else {
          termPrint([t('term.notFound', { cmd: name })]);
        }
      }
    }
  }

  /** ENCOM-hilsen i udviklerværktøjernes konsol, til den nysgerrige bruger. */
  function consoleGreeting() {
    const art = [
      ' _____ _   _ _____    ____ ____  ___ ____  ',
      '|_   _| | | | ____|  / ___|  _ \\|_ _|  _ \\ ',
      '  | | | |_| |  _|   | |  _| |_) || || | | |',
      '  | | |  _  | |___  | |_| |  _ < | || |_| |',
      '  |_| |_| |_|_____|  \\____|_| \\_\\___|____/ ',
    ].join('\n');
    console.log(`%c${art}`, 'color:#00e5ff;font-family:monospace;text-shadow:0 0 6px #00e5ff');
    console.log(
      "%cENCOM OS-12 · Greetings, program. · Flynn lives. · Flynn's terminal still answers: whoami",
      'color:#ff8a1e;font-family:monospace'
    );
  }

  // ---------- Opsætningsguide ----------

  let guidePage = 0;
  let guideMeterTimer = null;

  function openGuide(page = 0) {
    GUIDE_PAGES = GUIDE_FULL;
    guidePage = page;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('guide-dialog').showModal();
    renderGuide();
  }

  function renderGuide() {
    const name = GUIDE_PAGES[guidePage];
    for (const section of document.querySelectorAll('.guide-page')) section.hidden = section.dataset.page !== name;
    $('guide-step').textContent = t('guide.step', { n: guidePage + 1, total: GUIDE_PAGES.length });
    $('guide-back').hidden = guidePage === 0;
    $('guide-skip').hidden = name === 'done';
    $('guide-next').textContent = t(name === 'done' ? 'guide.finish' : name === 'welcome' ? 'guide.useSpotify' : 'guide.next');
    $('guide-audio-only').hidden = name !== 'welcome';
    $('guide-sound-text').textContent = t(GUIDE_PAGES === GUIDE_AUDIO ? 'guide.sound.textAny' : 'guide.sound.text');
    clearInterval(guideMeterTimer);
    guideMeterTimer = null;
    if (name === 'login') renderGuideLogin();
    if (name === 'sound') {
      updateGuideMeter();
      guideMeterTimer = setInterval(updateGuideMeter, 80);
    }
    if (name === 'playlist') {
      const input = $('guide-pl-input');
      if (!input.value) input.value = $('pl-input').value;
      input.focus();
    }
  }

  function renderGuideLogin() {
    const s = state.spotify;
    const as = s.user ? t('login.as', { name: s.user.displayName }) : '';
    $('guide-login-status').textContent = s.loggedIn ? t('guide.login.done', { as }) : t('status.notLoggedIn');
    $('guide-login').hidden = s.loggedIn;
    $('guide-login').disabled = loggingIn;
  }

  function updateGuideMeter() {
    const rms = state.capture.ok ? music.lastRms : 0;
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    const percent = Math.max(0, Math.min(100, ((db + 60) / 54) * 100));
    const hearing = state.capture.ok && !music.engine.silent;
    const fill = $('guide-meter-fill');
    fill.style.width = `${percent}%`;
    fill.classList.toggle('ok', hearing);
    $('guide-sound-status').textContent = t(hearing ? 'guide.sound.ok' : 'guide.sound.waiting');
  }

  function guideStep(delta) {
    const next = guidePage + delta;
    if (next >= GUIDE_PAGES.length) {
      $('guide-dialog').close();
      return;
    }
    guidePage = Math.max(0, next);
    renderGuide();
  }

  async function guideLoadPlaylist() {
    if (!state.spotify.loggedIn) {
      toast(t('load.needLogin'));
      guidePage = GUIDE_PAGES.indexOf('login');
      renderGuide();
      return;
    }
    const text = $('guide-pl-input').value;
    if (await loadCollection(text)) {
      saveSettingsSoon({ lastInput: text.trim() });
      guideStep(1);
    }
  }

  /** Guiden lukkes (færdig, sprunget over eller Esc): den vises ikke igen af sig selv. */
  function onGuideClosed() {
    clearInterval(guideMeterTimer);
    guideMeterTimer = null;
    if (!state.settings.onboardingDone && !state.info.selftest) {
      state.settings.onboardingDone = true;
      saveSettingsSoon({ onboardingDone: true });
    }
  }

  // ---------- Dialoger ----------

  function openSettings() {
    $('client-id').value = state.settings.builtInClientId ? '' : state.settings.clientId || '';
    $('client-id-check').textContent = '';
    $('redirect-uri').textContent = state.spotify.redirectUri || state.settings.redirectUri || '';
    $('set-theme').value = currentTheme();
    $('set-intro').checked = state.settings.showIntro !== false;
    $('set-intro-style').value = state.settings.introStyle === 'duel' ? 'duel' : 'war';
    $('set-intro-music').checked = state.settings.introMusic !== false;
    $('set-init-volume').value = String(Math.round(100 * (Number.isFinite(state.settings.initVolume) ? state.settings.initVolume : 1)));
    $('set-share-votes').checked = state.settings.shareVotes === true;
    $('set-peter-picks').checked = state.settings.peterPicks === true;
    $('set-classic').checked = state.settings.classicMode === true;
    $('set-follow-spotify').checked = state.settings.followSpotify !== false;
    renderSpotifyStatus();
    renderVizToggles();
    renderCaptureStatus();
    $('settings-dialog').showModal();
  }

  function markCurrentPreset() {
    const listEl = $('preset-list');
    const old = listEl.querySelector('li.current');
    if (old) old.classList.remove('current');
    if (!viz || !viz.current) return;
    const li = listEl.querySelector(`li[data-name="${CSS.escape(viz.current)}"]`);
    if (li) li.classList.add('current');
  }

  function filterPresets(query) {
    const needle = query.trim().toLowerCase();
    for (const li of $('preset-list').children) {
      li.hidden = Boolean(needle) && !li.dataset.name.toLowerCase().includes(needle);
    }
  }

  /** En række i preset-listen: ★ for favoritter, overstreget for derezzede (med ↺ for at få det tilbage). */
  function presetRow(name, hidden) {
    const li = document.createElement('li');
    li.dataset.name = name;
    li.title = lists.peterFav.has(name) || lists.peterHidden.has(name) ? t('presets.peterPick', { name }) : name;
    if (viz.isFavorite(name)) li.classList.add('fav');
    if (hidden) li.classList.add('derezzed');
    const label = document.createElement('span');
    label.className = 'preset-name-text';
    label.textContent = name;
    // ★ gør til favorit (som K); × derezzer (som D); ↺ tager et derezzet preset tilbage.
    const button = (cls, text, titleKey) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.title = t(titleKey);
      b.setAttribute('aria-label', b.title);
      return b;
    };
    if (hidden) {
      li.append(label, button('preset-restore', '↺', 'presets.restore'));
    } else {
      const fav = viz.isFavorite(name);
      li.append(label, button('preset-fav', fav ? '★' : '☆', fav ? 'presets.unfavourite' : 'presets.favourite'), button('preset-del', '×', 'presets.derez'));
    }
    return li;
  }

  function updatePresetCount() {
    const hidden = viz.allNames.filter((n) => lists.hidden.has(n)).length; // kun presets, der findes (Peters liste har også fjernede)
    const favs = viz.allNames.filter((n) => lists.favorites.has(n)).length;
    $('preset-count').textContent = t('presets.count', { count: viz.names.length, favs, hidden });
  }

  function openPresets() {
    if (!viz) return;
    const listEl = $('preset-list');
    // Bygges hver gang, så favoritter og derezzede altid passer.
    const hiddenSet = lists.hidden;
    const fragment = document.createDocumentFragment();
    for (const name of viz.allNames) fragment.append(presetRow(name, hiddenSet.has(name)));
    listEl.replaceChildren(fragment);
    updatePresetCount();
    $('preset-filter').value = '';
    filterPresets('');
    markCurrentPreset();
    $('presets-dialog').showModal();
    $('preset-filter').focus();
    const current = listEl.querySelector('li.current');
    if (current) current.scrollIntoView({ block: 'center' });
  }

  // Vinduerne (preset-listen, Settings, hjælpen og guiden) ligger i en kolonne i visualizerens højre side og dækker
  // aldrig billedet (Peter 05-10-2026; Flynns terminal undtaget). Er flere åbne, deler de kolonnen oven over
  // hinanden som i en tiling-vindueshåndtering (Omarchy): to får hver halvdelen, tre en tredjedel. De åbnes ikke
  // modalt, så de kan være åbne samtidig; Esc lukker det senest åbnede. Kolonnens bredde trækkes i venstre kant
  // og huskes på pc'en.
  const DOCKED = ['presets-dialog', 'settings-dialog', 'help-dialog', 'guide-dialog'];
  const DOCK_MIN_WIDTH = 260;
  const DOCK_WIDTH_KEY = 'dockWidth';
  const dockOrder = []; // åbne vinduer, ældst først (øverst)

  function dockWidth() {
    try {
      return Number(localStorage.getItem(DOCK_WIDTH_KEY)) || Number(localStorage.getItem('presetListWidth')) || 440;
    } catch {
      return 440;
    }
  }

  /** Visualizeren gøres smallere med kolonnens bredde (margin); vinduerne deler kolonnens højde. */
  function dockDialogs(width) {
    const open = dockOrder.map((id) => $(id)).filter((el) => el && el.open);
    const wrap = $('viz-wrap');
    if (!open.length) {
      wrap.style.marginRight = '';
      return undefined;
    }
    const r = wrap.getBoundingClientRect();
    const room = window.innerWidth - r.left; // visualizerens kolonne uden vinduerne
    const w = Math.round(Math.max(DOCK_MIN_WIDTH, Math.min(width || dockWidth(), room - 160)));
    wrap.style.marginRight = `${w}px`;
    // Højden fordeles efter vægte (træk i kanten mellem to vinduer, wireDocking); ukendte vinduer vejer 1.
    const weights = open.map((el) => dockWeights[el.id] || 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    let top = r.top;
    open.forEach((el, i) => {
      const h = (r.height * weights[i]) / sum;
      el.style.top = `${Math.round(top)}px`;
      el.style.height = `${Math.round(h)}px`;
      el.style.right = '0px';
      el.style.width = `${w}px`;
      el.querySelector('.dock-split').hidden = i === open.length - 1; // kun mellem to vinduer
      top += h;
    });
    return w;
  }

  // Vinduernes andel af kolonnens højde (relative tal), huskes på pc'en.
  const DOCK_WEIGHTS_KEY = 'dockWeights';
  let dockWeights = {};
  try {
    dockWeights = JSON.parse(localStorage.getItem(DOCK_WEIGHTS_KEY) || '{}') || {};
  } catch {
    dockWeights = {};
  }
  const DOCK_MIN_HEIGHT = 120;

  /** Kanten under vinduet `el` trækkes: det og vinduet under det bytter højde. */
  function dragSplit(el, event) {
    const open = dockOrder.map((id) => $(id)).filter((d) => d && d.open);
    const i = open.indexOf(el);
    const below = open[i + 1];
    if (i < 0 || !below) return;
    const split = el.querySelector('.dock-split');
    event.preventDefault();
    split.setPointerCapture(event.pointerId);
    split.classList.add('dragging');
    const startY = event.clientY;
    const h1 = el.getBoundingClientRect().height;
    const h2 = below.getBoundingClientRect().height;
    // Vægtene sættes i pixel, så de to vinduers samlede andel bliver den samme; de andre røres ikke.
    const total = open.reduce((a, d) => a + (dockWeights[d.id] || 1), 0);
    const colHeight = open.reduce((a, d) => a + d.getBoundingClientRect().height, 0);
    const perPx = total / colHeight;
    const move = (e) => {
      const a = Math.max(DOCK_MIN_HEIGHT, Math.min(h1 + h2 - DOCK_MIN_HEIGHT, h1 + (e.clientY - startY)));
      dockWeights[el.id] = a * perPx;
      dockWeights[below.id] = (h1 + h2 - a) * perPx;
      dockDialogs();
    };
    const up = () => {
      split.classList.remove('dragging');
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      split.removeEventListener('pointercancel', up);
      try {
        localStorage.setItem(DOCK_WEIGHTS_KEY, JSON.stringify(dockWeights));
      } catch {
        // uden lager huskes fordelingen bare ikke
      }
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
    split.addEventListener('pointercancel', up);
  }

  /** Esc lukker det senest åbnede vindue i kolonnen. Returnerer true, hvis der var et. */
  function closeTopDocked() {
    const top = [...dockOrder].reverse().map((id) => $(id)).find((el) => el && el.open);
    if (!top) return false;
    top.close();
    return true;
  }

  function wireDocking() {
    for (const id of DOCKED) {
      const el = $(id);
      // Alle steder, der åbner vinduet med showModal, åbner det nu i kolonnen, ikke modalt.
      el.showModal = () => {
        if (el.open) return;
        if (!dockOrder.includes(id)) dockOrder.push(id); // med det samme, så rækkefølgen er den, de blev åbnet i
        HTMLDialogElement.prototype.show.call(el);
      };
      new MutationObserver(() => {
        const i = dockOrder.indexOf(id);
        if (el.open && i < 0) dockOrder.push(id);
        if (!el.open && i >= 0) dockOrder.splice(i, 1);
        dockDialogs();
      }).observe(el, { attributes: true, attributeFilter: ['open'] });
      el.querySelector('.dock-split').addEventListener('pointerdown', (event) => dragSplit(el, event));
      const handle = el.querySelector('.dock-resize');
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('dragging');
        const right = el.getBoundingClientRect().right;
        let w = dockWidth();
        const move = (e) => {
          w = dockDialogs(right - e.clientX);
        };
        const up = () => {
          handle.classList.remove('dragging');
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          try {
            localStorage.setItem(DOCK_WIDTH_KEY, String(w));
          } catch {
            // uden lager huskes bredden bare ikke
          }
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }
    window.addEventListener('resize', () => dockDialogs());
  }

  function loadPresetByName(name) {
    if (viz && viz.load(name, state.settings.visualizer.blendSeconds)) director.notifyChange(nowSeconds(), directorConfig());
  }

  // ---------- Hændelser ----------

  function wireUi() {
    $('btn-prev').addEventListener('click', () => transport('prev'));
    $('btn-play').addEventListener('click', () => transport('play'));
    $('btn-pause').addEventListener('click', () => transport('pause'));
    $('btn-stop').addEventListener('click', () => transport('stop'));
    $('btn-next').addEventListener('click', () => transport('next'));
    $('btn-eject').addEventListener('click', () => {
      $('pl-input').focus();
      $('pl-input').select();
    });

    $('clock').addEventListener('click', () => {
      state.settings.clockMode = state.settings.clockMode === 'remaining' ? 'elapsed' : 'remaining';
      saveSettingsSoon({ clockMode: state.settings.clockMode });
    });
    $('mini-vis').addEventListener('click', () => {
      state.settings.miniVis = mini.cycleMode();
      saveSettingsSoon({ miniVis: state.settings.miniVis });
    });
    // Påskeæg: ordmærket hilser tilbage.
    // Dobbeltklik på "THE GRID": en hilsen og versionen.
    document.querySelector('.wordmark').addEventListener('dblclick', () => toast(t('egg.wordmark', { version: `v${state.info.version}` }), 'info', 5000));

    const seek = $('seek');
    seek.addEventListener('input', () => {
      state.seeking = true;
      setSliderFill(seek, Number(seek.value) / 10);
    });
    seek.addEventListener('change', async () => {
      state.seeking = false;
      const item = state.playback && state.playback.item;
      if (!item || !item.durationMs) return;
      const ms = (Number(seek.value) / 1000) * item.durationMs;
      try {
        await call(bridge.spotify.seek(ms));
        state.playback.progressMs = ms;
        state.playbackReceivedAt = performance.now();
        state.stopped = false;
        schedulePoll(500);
      } catch (err) {
        reportError(err);
      }
    });

    const volume = $('volume');
    volume.addEventListener('input', () => {
      state.volumeDragging = true;
      setSliderFill(volume, Number(volume.value));
    });
    volume.addEventListener('change', async () => {
      state.volumeDragging = false;
      try {
        await call(bridge.spotify.setVolume(Number(volume.value)));
      } catch (err) {
        reportError(err);
      }
    });
    setSliderFill(volume, Number(volume.value));

    $('pl-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('pl-input');
      // Link-feltet er også en lille ENCOM-terminal: et ord fra Tron udløser et påskeæg.
      const egg = eggs.command(input.value);
      if (egg && runEgg(egg)) {
        input.value = '';
        return;
      }
      loadCollection(input.value);
    });
    $('pl-play-context').addEventListener('click', playWholeContext);
    $('pl-empty-action').addEventListener('click', () => {
      if (state.spotify.configured && !state.spotify.loggedIn) login();
      else openSettings();
    });
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-help').addEventListener('click', () => $('help-dialog').showModal());

    // Pilene er det eneste sted, presettets navn vises.
    $('viz-prev').addEventListener('click', () => manualPreset(-1));
    $('viz-next').addEventListener('click', () => manualPreset(1));
    $('viz-random').addEventListener('click', () => setVisualizerSetting({ random: !state.settings.visualizer.random }));
    $('viz-auto').addEventListener('click', () => setVisualizerSetting({ autoCycle: !state.settings.visualizer.autoCycle }));
    $('viz-list').addEventListener('click', openPresets);
    $('viz-full').addEventListener('click', toggleFullscreen);
    $('viz').addEventListener('dblclick', toggleFullscreen);
    $('capture-start').addEventListener('click', () => startCapture({ fromUser: true }));

    // Indstillinger: Spotify
    $('open-dashboard').addEventListener('click', () => call(bridge.openSpotifyDashboard()).catch((err) => reportError(err)));
    $('copy-redirect').addEventListener('click', async () => {
      await call(bridge.copyText($('redirect-uri').textContent));
      toast(t('redirect.copied'));
    });
    $('save-client-id').addEventListener('click', saveClientId);
    $('client-id').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveClientId();
    });
    $('use-built-in').addEventListener('click', useBuiltInClientId);
    $('spotify-login').addEventListener('click', login);
    $('spotify-logout').addEventListener('click', async () => {
      try {
        state.spotify = await call(bridge.spotify.logout());
        renderSpotifyStatus();
        toast(t('logout.done'));
      } catch (err) {
        reportError(err);
      }
    });

    // Indstillinger: udseende og sprog
    $('set-theme').addEventListener('change', (e) => setTheme(e.target.value));
    $('set-init-volume').addEventListener('input', (e) => {
      state.settings.initVolume = Number(e.target.value) / 100;
      saveSettingsSoon({ initVolume: state.settings.initVolume });
    });
    $('set-intro-music').addEventListener('change', (e) => {
      state.settings.introMusic = e.target.checked;
      saveSettingsSoon({ introMusic: e.target.checked });
    });
    $('set-intro-style').addEventListener('change', (e) => {
      state.settings.introStyle = e.target.value;
      saveSettingsSoon({ introStyle: e.target.value });
    });
    $('set-share-votes').addEventListener('change', (e) => {
      state.settings.shareVotes = e.target.checked;
      saveSettingsSoon({ shareVotes: e.target.checked });
    });
    $('set-follow-spotify').addEventListener('change', (e) => {
      state.settings.followSpotify = e.target.checked;
      saveSettingsSoon({ followSpotify: e.target.checked });
      if (e.target.checked) followSpotifyContext(state.playback, { force: true });
    });
    $('set-classic').addEventListener('change', (e) => {
      state.settings.classicMode = e.target.checked;
      saveSettingsSoon({ classicMode: e.target.checked });
      if (!viz || REVIEW) return;
      applyPresetLists();
      if (e.target.checked && !viz.names.includes(viz.current)) nextPreset(); // straks over til en klassiker
    });
    $('set-peter-picks').addEventListener('change', (e) => {
      state.settings.peterPicks = e.target.checked;
      saveSettingsSoon({ peterPicks: e.target.checked });
      if (viz && !REVIEW) applyPresetLists();
    });
    $('set-intro').addEventListener('change', (e) => {
      state.settings.showIntro = e.target.checked;
      saveSettingsSoon({ showIntro: e.target.checked });
    });
    $('play-intro').addEventListener('click', () => {
      $('settings-dialog').close();
      playIntro();
    });
    $('run-guide').addEventListener('click', () => openGuide());

    // Indstillinger: visualizer og musik
    $('set-auto').addEventListener('change', (e) => setVisualizerSetting({ autoCycle: e.target.checked }));
    $('set-random').addEventListener('change', (e) => setVisualizerSetting({ random: e.target.checked }));
    $('set-cycle').addEventListener('change', (e) => {
      const value = Math.min(600, Math.max(5, Number(e.target.value) || 20));
      setVisualizerSetting({ cycleSeconds: value });
    });
    $('set-blend').addEventListener('change', (e) => {
      const value = Math.min(10, Math.max(0, Number(e.target.value)));
      setVisualizerSetting({ blendSeconds: Number.isFinite(value) ? value : 2.7 });
    });
    $('set-max-fps').addEventListener('change', (e) => setVisualizerSetting({ maxFps: Number(e.target.value) }));
    $('set-reactivity').addEventListener('change', (e) => {
      const value = Math.min(100, Math.max(20, Number(e.target.value)));
      setVisualizerSetting({ reactivity: Number.isFinite(value) ? value / 100 : 0.7 });
    });
    $('set-beatsync').addEventListener('change', (e) => setMusicSetting({ beatSync: e.target.checked }));
    $('set-sections').addEventListener('change', (e) => setMusicSetting({ sectionChanges: e.target.checked }));
    $('set-hardcuts').addEventListener('change', (e) => setMusicSetting({ hardCuts: e.target.checked }));
    $('set-smart').addEventListener('change', (e) => setMusicSetting({ smartSelection: e.target.checked }));
    $('set-agc').addEventListener('change', (e) => setMusicSetting({ agc: e.target.checked }));
    $('set-latency').addEventListener('change', (e) => {
      const value = Math.round(Math.min(500, Math.max(0, Number(e.target.value) || 0)));
      setMusicSetting({ latencyMs: value });
    });
    $('capture-restart').addEventListener('click', async () => {
      if (await restartCapture()) toast(t('capture.restarted'));
    });

    // Guide
    $('guide-next').addEventListener('click', () => {
      if (GUIDE_PAGES[guidePage] === 'playlist' && $('guide-pl-input').value.trim() && !state.collection) guideLoadPlaylist();
      else guideStep(1);
    });
    $('guide-audio-only').addEventListener('click', () => {
      GUIDE_PAGES = GUIDE_AUDIO;
      guideStep(1);
    });
    $('guide-back').addEventListener('click', () => {
      if (guidePage === 1) GUIDE_PAGES = GUIDE_FULL; // tilbage til velkomsten: begge veje åbne igen
      guideStep(-1);
    });
    $('guide-skip').addEventListener('click', () => $('guide-dialog').close());
    $('guide-login').addEventListener('click', login);
    $('guide-pl-form').addEventListener('submit', (event) => {
      event.preventDefault();
      guideLoadPlaylist();
    });
    $('guide-dialog').addEventListener('close', onGuideClosed);

    // Flynns terminal
    $('term-form').addEventListener('submit', (event) => {
      event.preventDefault();
      termRun($('term-input').value);
      $('term-input').value = '';
    });
    $('term-input').addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      termHistoryIndex = Math.max(0, Math.min(termHistory.length, termHistoryIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      $('term-input').value = termHistory[termHistoryIndex] || '';
    });
    $('term-output').addEventListener('click', () => $('term-input').focus());

    // Presets
    wireDocking();
    $('preset-filter').addEventListener('input', (e) => filterPresets(e.target.value));
    $('preset-filter').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const first = Array.from($('preset-list').children).find((li) => !li.hidden);
      if (first) loadPresetByName(first.dataset.name);
    });
    $('preset-list').addEventListener('click', (event) => {
      const li = event.target.closest('li[data-name]');
      if (!li) return;
      if (event.target.closest('.preset-del')) {
        event.stopPropagation();
        votePreset(li.dataset.name, 'derez');
        return;
      }
      if (event.target.closest('.preset-fav')) {
        event.stopPropagation();
        votePreset(li.dataset.name, 'keep', { toggle: true });
        return;
      }
      if (event.target.closest('.preset-restore')) {
        event.stopPropagation();
        restorePreset(li.dataset.name);
        return;
      }
      if (li.classList.contains('derezzed')) return; // derezzede vises ikke; ↺ tager dem tilbage
      loadPresetByName(li.dataset.name);
    });

    // Luk dialoger på ×-knappen eller ved klik på baggrunden. Guiden lukkes kun med sine egne knapper.
    for (const dialog of document.querySelectorAll('dialog')) {
      if (dialog.id === 'guide-dialog') continue;
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
      });
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollPlayback();
    });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('mousemove', wakeCursor);
    new ResizeObserver(measureMarquee).observe($('marquee'));
  }

  function onKeyDown(event) {
    // Vinduerne i kolonnen er ikke modale, så Esc lukker dem her (det senest åbnede først).
    if (event.key === 'Escape' && !document.fullscreenElement && closeTopDocked()) {
      event.preventDefault();
      return;
    }
    if (event.key === 'F1') {
      event.preventDefault();
      $('help-dialog').showModal();
      return;
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      $('pl-input').focus();
      $('pl-input').select();
      return;
    }
    if (isTyping(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
    // Vinduerne i kolonnen dækker ikke billedet, så genvejene virker, mens de er åbne (fx L med Settings åben).
    // Kun Flynns terminal og guiden spærrer. Har en knap eller liste i et vindue fokus, hører mellemrum, Enter og
    // pilene til den.
    const blocking = [...document.querySelectorAll('dialog[open]')].some((d) => !DOCKED.includes(d.id) || d.id === 'guide-dialog');
    if (blocking) return;
    if (event.target.closest && event.target.closest('dialog') && /^( |Enter|Arrow\w+|Backspace)$/.test(event.key)) return;

    // Konami-koden: ↑↑↓↓←→←→BA åbner Game Grid (kun kamp, flere cykler).
    const konami = eggs.key(event.key);
    if (konami) {
      event.preventDefault();
      if (konami === 'konami') runEgg('battle');
      return;
    }

    const actions = {
      z: () => transport('prev'),
      x: () => transport('play'),
      c: () => transport('pause'),
      v: () => transport('stop'),
      b: () => transport('next'),
      // Mellemrum og de andre genveje skifter uden at vise navnet; det gør kun pilene.
      ' ': () => spacePreset(),
      n: () => spacePreset(), // som mellemrum (også genoptage automatiske skift)
      k: () => reviewVote('keep'),
      d: () => reviewVote('derez'),
      h: () => nextPreset({ hardCut: true }),
      backspace: () => prevPreset(),
      p: () => prevPreset(),
      arrowright: () => manualPreset(1),
      arrowleft: () => manualPreset(-1),
      r: () => setVisualizerSetting({ random: !state.settings.visualizer.random }),
      a: () => setVisualizerSetting({ autoCycle: !state.settings.visualizer.autoCycle }),
      l: openPresets,
      t: showCurrentTitle,
      f: toggleFullscreen,
      '?': () => $('help-dialog').showModal(),
    };
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  }

  async function saveClientId() {
    const value = $('client-id').value.trim();
    const check = $('client-id-check');
    if (!value) {
      useBuiltInClientId();
      return;
    }
    try {
      // Spørg Spotify først; det fanger fx et Client Secret, der er sat ind ved en fejl.
      check.textContent = t('clientId.checking');
      check.dataset.kind = '';
      const result = await call(bridge.spotify.checkClientId(value));
      if (result && result.valid === false) {
        check.textContent = t('clientId.invalid');
        check.dataset.kind = 'error';
        return;
      }
      state.settings = await call(bridge.setSettings({ clientId: value }));
      check.textContent = t('clientId.valid');
      check.dataset.kind = 'ok';
      await refreshSpotifyStatus();
      toast(t('clientId.saved'));
    } catch (err) {
      check.textContent = errorText(err);
      check.dataset.kind = 'error';
    }
  }

  async function useBuiltInClientId() {
    try {
      state.settings = await call(bridge.setSettings({ clientId: '' }));
      $('client-id').value = '';
      $('client-id-check').textContent = '';
      await refreshSpotifyStatus();
      toast(t('clientId.removed'));
    } catch (err) {
      reportError(err);
    }
  }

  let loggingIn = false;
  async function login() {
    if (loggingIn) return;
    loggingIn = true;
    const buttons = [$('spotify-login'), $('guide-login')];
    for (const button of buttons) {
      button.disabled = true;
      button.textContent = t('login.waiting');
    }
    toast(t('login.hint'), 'info', 8000);
    try {
      state.spotify = await call(bridge.spotify.login());
      const as = state.spotify.user ? t('login.as', { name: state.spotify.user.displayName }) : '';
      toast(t('login.done', { as }));
      pollPlayback();
      if ($('pl-input').value.trim()) loadCollection($('pl-input').value);
    } catch (err) {
      reportError(err, 'login.failed');
    } finally {
      loggingIn = false;
      for (const button of buttons) button.textContent = t('login.button');
      renderSpotifyStatus();
    }
  }

  // ---------- Selvtest (npm run selftest) ----------

  const DEMO_COLLECTION = {
    type: 'playlist',
    id: 'demo',
    uri: null,
    name: 'Selftest (demo data)',
    owner: 'The Grid',
    imageUrl: null,
    total: 14,
    itemsRestricted: false,
    tracks: Array.from({ length: 14 }, (_, i) => ({
      position: i,
      id: `demo-${i}`,
      uri: null,
      name: `Test track ${i + 1}`,
      artists: ['Demo artist'],
      album: 'Demo data',
      durationMs: 151000 + i * 13000,
      isLocal: false,
      playable: true,
      type: 'track',
    })),
  };

  /** Venter, til introen er nået et bestemt antal sekunder frem. `seconds` kan være en funktion, da duellens tider først kendes, når kampen slutter. */
  function waitForIntro(seconds) {
    return new Promise((resolve) => {
      const check = () => {
        const target = typeof seconds === 'function' ? seconds() : seconds;
        if (!intro || !intro.running || intro.elapsed() >= (target === undefined ? Infinity : target)) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  function setupSelftest() {
    applyTheme('grid'); // selvtestens datamappe kan have Clu-temaet fra påskeægget i en tidligere kørsel
    state.collection = DEMO_COLLECTION;
    state.selectedIndex = 2;
    renderCollection();
    list.select(2);

    const levels = { phase: 'before', before: 0, during: 0, after: 0 };
    const startedAt = performance.now();
    const startFrames = viz ? viz.frames : 0;
    setInterval(() => {
      levels[levels.phase] = Math.max(levels[levels.phase], mini.level());
    }, 25);
    bridge.selftest.onPhase((phase) => {
      levels.phase = phase === 'audio-start' ? 'during' : 'after';
    });
    // Tjek lydløst, at Init kan indlæses (den afspilles ikke i selvtesten).
    const media = { initSeconds: null, initError: null };
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => (media.initSeconds = Math.round(probe.duration)));
    probe.addEventListener('error', () => (media.initError = String(probe.error && probe.error.code)));
    probe.src = INIT_TRACK;
    bridge.selftest.onCollect(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      const round = (n, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;
      const { track, stream } = state.capture;
      const frames = viz ? viz.frames - startFrames : 0;
      bridge.selftest.report({
        ok: Boolean(state.capture.ok && levels.during > 0.01 && frames > 30),
        capture: {
          ok: state.capture.ok,
          error: state.capture.error,
          label: track ? track.label : null,
          readyState: track ? track.readyState : null,
          videoTracks: stream ? stream.getVideoTracks().map((vt) => vt.readyState) : [],
          contextState: audioContext.state,
          sampleRate: audioContext.sampleRate,
        },
        levels: {
          beforePeakRms: round(levels.before),
          duringPeakRms: round(levels.during),
          afterPeakRms: round(levels.after),
        },
        render: viz
          ? { frames, fps: round(frames / seconds, 1), webgl2: viz.isWebGL2, size: `${viz.canvas.width}x${viz.canvas.height}` }
          : null,
        presets: viz ? { count: viz.names.length, current: viz.current, failed: Array.from(viz.failed), transitions: Boolean(viz.transitionsInstalled), measured: Object.keys(window.gridPresetStats || {}).length } : null,
        media,
        ui: {
          theme: currentTheme(),
          tracks: list.count(),
          marquee: $('marquee').textContent.trim(),
          clock: $('clock').textContent,
          captureStatus: $('capture-status').textContent,
        },
        music: {
          silent: music.engine.state.silent,
          tempoValid: music.engine.state.tempoValid,
          bpm: music.engine.state.bpm && round(music.engine.state.bpm, 1),
          sectionIndex: music.engine.state.sectionIndex,
          agcGain: round(music.agcGain, 2),
          vizAsleep: Boolean(viz && viz.asleep),
        },
      });
    });
    bridge.selftest.onShow(async (view) => {
      if (view !== 'intro-text') {
        for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      }
      if (view === 'settings') openSettings();
      else if (view === 'presets') openPresets();
      else if (view === 'help') $('help-dialog').showModal();
      else if (view === 'docked-stack') {
        // Tre vinduer i kolonnen på én gang: de skal dele højden, og billedet må ikke dækkes.
        openPresets();
        openSettings();
        $('help-dialog').showModal();
      }
      else if (view === 'terminal') {
        openTerminal();
        termRun('cat easter_eggs.txt');
        await termQueue;
      }
      else if (view === 'guide') openGuide(GUIDE_PAGES.indexOf('sound'));
      else if (view === 'welcome') {
        state.collection = null;
        state.selectedIndex = -1;
        renderCollection();
      } else if (view === 'intro') {
        playIntro();
        await waitForIntro(1.2); // holdene rezzer ind
      } else if (view === 'intro-battle') {
        await waitForIntro(7); // kampen raser, og WELCOME TO THE er ved at blive skrevet
      } else if (view === 'intro-duel') {
        await waitForIntro(() => intro.lastTwoAt && intro.lastTwoAt + 1.5); // de to sidste kæmper
      } else if (view === 'intro-text') {
        await waitForIntro(() => intro.textDone && intro.textDone + 0.6); // GRID er skrevet færdig
      } else if (view === 'intro-classic') {
        // Den anden intro ("Battle and duel"): lige før taberen rammer vinderens væg.
        if (intro && intro.running) intro.finish(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        playIntro({ style: 'duel' });
        await waitForIntro(() => intro.crashAt && intro.crashAt - 0.55);
      } else if (view === 'battle-win') {
        // Game Grid: vinderholdets tekst.
        if (intro && intro.running) intro.finish(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        runEgg('battle');
        await waitForIntro(() => intro.winnerAt && intro.winnerAt + 1.2);
      } else if (view === 'tron-overlay') {
        // Tron-laget ("tron" i terminalen) over billedet, lige efter et drop. Indstillingen gemmes ikke.
        if (intro && intro.running) intro.finish(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        setSleeping(false);
        tronOverlay.setEnabled(true);
        tronOverlay.setAsleep(false);
        tronOverlay.beat({ downbeat: true, bpm: 120 });
        tronOverlay.event('drop');
        await new Promise((resolve) => setTimeout(resolve, 1100));
      } else if (view === 'battle-epic') {
        // "epic battle" i terminalen: 40 cykler midt i kampen.
        tronOverlay.setEnabled(tronOn);
        if (intro && intro.running) intro.finish(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        runEgg('epic');
        await waitForIntro(12);
      } else if (view === 'fullscreen') {
        // Fuld skærm kræver et klik fra brugeren; selvtesten sætter samme CSS-tilstand direkte.
        if (intro && intro.running) intro.finish(true);
        await new Promise((resolve) => setTimeout(resolve, 450));
        document.body.classList.add('fullscreen', 'cursor-hidden');
        window.dispatchEvent(new Event('resize'));
        // Midt i en overgang: cirklen åbner sig fra midten i ryk på slagene (installTransitions i visualizer.js).
        setSleeping(false);
        viz.setNextTransition({ pattern: 3, beats: 4 });
        viz.next({ random: true, blendSeconds: 2 });
        await new Promise((resolve) => setTimeout(resolve, 900));
      } else if (view.startsWith('egg-')) {
        // Et påskeæg midt i sin animation.
        document.body.classList.remove('fullscreen', 'cursor-hidden');
        if (stopEgg) stopEgg(true);
        const name = view.slice(4);
        const at = { users: 1900, jazz: 1500, encom: 3000, zen: 2600, clu: 1500, rinzler: 1000, greetings: 2400 };
        runEgg(name);
        await new Promise((resolve) => setTimeout(resolve, at[name] || 1200));
      } else if (view === 'drew-audio') {
        // Afspiller Init rigtigt i fire sekunder og logger lydens tilstand (laver lyd).
        if (stopEgg) stopEgg(true);
        // Som ved "drew": vent, til det forrige show har ryddet op. Ellers nulstiller dets oprydning
        // referencen til det nye show, og målingen bliver null.
        if (drewShow) {
          drewShow.stop();
          drewShow = null;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        runDrew({ forceMusic: true });
        for (const ms of [300, 1500, 4000]) {
          await new Promise((resolve) => setTimeout(resolve, ms === 300 ? 300 : ms === 1500 ? 1200 : 2500));
          console.log('drew-audio', ms, JSON.stringify(drewShow && drewShow.o.debugTrack ? drewShow.o.debugTrack() : null));
        }
      } else if (view === 'drew' || view === 'drew-pound') {
        // "drew": 6 s inde i den stille start. "drew-pound": 30 s inde, midt i hamren.
        document.body.classList.remove('fullscreen', 'cursor-hidden');
        if (stopEgg) stopEgg(true);
        if (drewShow) {
          drewShow.stop();
          drewShow = null;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        runDrew({ timeOffset: view === 'drew' ? 4 : 28 });
        await new Promise((resolve) => setTimeout(resolve, 2300));
      } else if (view === 'terminal-return') {
        // Et påskeæg startet fra terminalen skal ende tilbage i terminalen.
        if (stopEgg) stopEgg(true);
        openTerminal();
        await termQueue;
        termRun('greetings program');
        const started = performance.now();
        await new Promise((resolve) => {
          const check = () => {
            const back = $('terminal-dialog').open && $('term-output').textContent.includes('program ended');
            if (back || performance.now() - started > 9000) resolve();
            else setTimeout(check, 100);
          };
          check();
        });
        await termQueue;
      } else if (view === 'clu') {
        document.body.classList.remove('fullscreen', 'cursor-hidden');
        await new Promise((resolve) => setTimeout(resolve, 450));
        applyTheme('clu'); // kun til billedet; gemmes ikke
      }
      // To billeder senere er visningen garanteret tegnet.
      requestAnimationFrame(() => requestAnimationFrame(() => bridge.selftest.shown(view)));
    });
  }

  // ---------- Start ----------

  async function init() {
    [state.info, state.settings] = await Promise.all([call(bridge.getAppInfo()), call(bridge.getSettings())]);
    if (REVIEW) {
      await loadScript('presets/review-pack.js');
      // I rækkefølge og uden automatiske skift: Peter bladrer selv.
      state.settings.visualizer = { ...state.settings.visualizer, autoCycle: false, random: false, lastPreset: null };
    }
    eggs = new window.Visamp.Eggs();
    applyTheme(state.settings.theme || 'grid');

    // Introen starter med det samme, så resten af opstarten sker bag den.
    // Lige efter en opdatering (genstart midt i en session) springes introen over.
    const showIntro = !state.info.selftest && !REVIEW && !state.info.updatedFrom && state.settings.showIntro !== false;
    const introDone = showIntro ? playIntro() : Promise.resolve();
    // Introens vinder bestemmer temaet: orange → Clus tema, blå → det blå. Classic røres ikke.
    introDone.then((info) => {
      const name = info && info.winner && info.winner.name;
      if (!name || !['grid', 'clu'].includes(currentTheme())) return;
      setTheme(name === 'orange' ? 'clu' : 'grid');
    });
    if (!showIntro) $('intro').hidden = true;

    audioContext = new AudioContext({ latencyHint: 'interactive' });
    music = new window.Visamp.MusicListener(audioContext);
    music.engine.setAudioOnly(!state.spotify.loggedIn); // opdateres af renderSpotifyStatus ved login/log ud
    music.setOptions({ agc: state.settings.music.agc, latencyMs: state.settings.music.latencyMs });
    director = new window.VisampMusic.PresetDirector();
    beatDot = $('beat-dot');
    mini = new window.Visamp.MiniSpectrum($('mini-vis'), { mode: state.settings.miniVis, theme: currentTheme() });
    mini.connect(audioContext, music.output);
    mini.start();
    list = new window.Visamp.PlaylistView($('pl-list'), {
      onActivate: playTrack,
      onSelect: (index) => {
        state.selectedIndex = index;
      },
    });

    applyTranslations();
    renderCaptureMessage();
    try {
      initVisualizer();
    } catch (err) {
      console.error('The visualizer could not start:', err);
      setCaptureMessage('viz.failed', { detail: err.message });
      $('capture-start').hidden = true;
      $('capture-overlay').hidden = false;
    }

    wireUi();
    renderVizToggles();
    consoleGreeting();
    await document.fonts.load('23px VT323').catch(() => {});
    measureMarquee();
    await refreshSpotifyStatus();

    if (state.info.selftest) setupSelftest();
    bridge.audio.onDevice(onOutputDevice);
    try {
      state.outputDevice = await call(bridge.audio.currentDevice());
    } catch {
      state.outputDevice = null;
    }
    await startCapture();
    requestAnimationFrame(musicLoop);
    setInterval(lcdTick, LCD_TICK_MS);
    setInterval(pollPlayback, POLL_MS);
    pollPlayback();

    if (!state.info.selftest && state.spotify.loggedIn && state.settings.lastInput) {
      $('pl-input').value = state.settings.lastInput;
      loadCollection(state.settings.lastInput, { quiet: true });
    }

    // Første gang: guiden efter introen.
    await introDone;
    if (!state.info.selftest && !REVIEW && !state.settings.onboardingDone) openGuide();
    if (REVIEW) toast(t('review.start', { count: viz.names.length }), 'info', 9000);
    setupUpdates();
  }

  init().catch((err) => {
    console.error('The Grid could not start:', err);
    if (intro && intro.running) intro.finish(true);
    toast(t('app.failed', { detail: err.message }), 'error', 30000);
  });
})();
