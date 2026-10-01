'use strict';

const os = require('node:os');
const { parseSpotifyInput } = require('./spotify-parse');
const { PlaybackController } = require('./playback');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch, der husker hver udveksling med Spotify (metode, sti, status og starten af svaret). */
function recordingFetch(exchanges) {
  return async (url, init = {}) => {
    const res = await fetch(url, init);
    const text = await res.text();
    const parsed = new URL(url);
    exchanges.push({
      method: init.method || 'GET',
      path: parsed.pathname + parsed.search.replace(/device_id=[^&]+/, 'device_id=…'),
      status: res.status,
      requestBody: init.body ? String(init.body).slice(0, 300) : undefined,
      responseBody: text ? text.slice(0, 300) : undefined,
    });
    return { status: res.status, ok: res.ok, headers: res.headers, text: async () => text };
  };
}

function summarizeState(state) {
  if (!state) return null;
  return {
    isPlaying: state.isPlaying,
    device: state.device && `${state.device.name} (${state.device.type})`,
    track: state.item && `${state.item.artists.join(', ')} - ${state.item.name}`,
    contextUri: state.contextUri,
  };
}

/** Den samme afspilningsforespørgsel, som rendereren bygger, når man trykker afspil på første nummer. */
function playTargetFor(collection) {
  const track = collection.tracks.find((t) => t.playable && t.uri);
  if (!track) return null;
  if (collection.type !== 'track' && collection.uri && !collection.itemsRestricted) {
    return { contextUri: collection.uri, position: track.position, trackUri: track.uri };
  }
  if (collection.uri && collection.itemsRestricted) return { contextUri: collection.uri, trackUri: track.uri };
  return { trackUri: track.uri, parentUri: track.parentUri };
}

/**
 * `npm run diagnose`: læser Spotify-tilstanden uden at ændre noget.
 * `npm run diagnose -- --play`: prøver desuden at afspille det sidst hentede link med præcis samme kode
 * som afspil-knappen og viser Spotifys svar. Eksterne links og medietaster registreres kun, de udføres ikke.
 *
 * Eksperimenter, der sender rå kommandoer og kan afbryde musikken:
 *   --experiment        den løse "uris"-kommando med og uden forudgående overførsel. Den tømte afspilleren i
 *                       Spotify-appen 1.301.234.0 den 29-09-2026; kør den for at se, om Spotify har rettet det.
 *   --experiment=album  nummeret i albummets kontekst (det The Grid gør nu).
 *   --experiment=pause-resume  pause og fortsæt.
 *
 * Kører på en kopi af datamappen og fornyer aldrig login. Tokens og enheds-id'er udskrives aldrig.
 */
async function runDiagnose({ auth, store, makeApi, tryPlay = false, experiment = false }) {
  const exchanges = [];
  const api = makeApi(recordingFetch(exchanges));
  const settings = store.getSettings();
  const tokens = store.tokenStore.load();
  const report = {
    configured: Boolean(settings.clientId),
    loggedIn: auth.isLoggedIn(),
    grantedScopes: tokens && tokens.scope ? tokens.scope.split(' ').filter(Boolean).sort() : [],
    lastInput: settings.lastInput || null,
  };

  const step = async (name, fn) => {
    try {
      report[name] = await fn();
    } catch (err) {
      report[name] = { error: err.code || 'ERROR', message: err.message, status: err.status };
    }
  };

  if (!report.loggedIn) return report;

  await step('me', async () => {
    const me = await api.getMe();
    return { id: me.id, displayName: me.display_name, product: me.product || '(no longer provided by Spotify)' };
  });

  await step('devices', async () =>
    (await api.getDevices()).map((d) => ({
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      isRestricted: d.is_restricted,
      isPrivateSession: d.is_private_session,
      volumePercent: d.volume_percent,
    }))
  );

  await step('playback', async () => summarizeState(await api.getPlaybackState()));

  let collection = null;
  const ref = parseSpotifyInput(settings.lastInput || '');
  if (ref) {
    await step('lastCollection', async () => {
      collection = await api.getCollection(ref);
      const first = collection.tracks[0];
      return {
        type: collection.type,
        name: collection.name,
        tracks: collection.tracks.length,
        itemsRestricted: Boolean(collection.itemsRestricted),
        firstTrack: first && { name: first.name, uri: first.uri, playable: first.playable, isLocal: first.isLocal },
      };
    });
  }

  // --search=<tekst>: søgningen, som påskeægget "drew" bruger (kun læsning), med Spotifys rå svar.
  const searchArg = process.argv.find((a) => a.startsWith('--search='));
  if (searchArg) {
    const query = searchArg.slice('--search='.length);
    const before = exchanges.length;
    await step('search', async () => ({ query, track: await api.searchTrack(query) }));
    report.searchExchanges = exchanges.slice(before);
  }

  if (tryPlay && collection) {
    const opened = [];
    const mediaKeys = [];
    const controller = new PlaybackController({
      api,
      auth,
      openExternal: async (url) => opened.push(url),
      sendMediaKey: async (key) => mediaKeys.push(key),
    });
    const target = playTargetFor(collection);
    const before = exchanges.length;
    await step('playAttempt', async () => {
      if (!target) return { error: 'NOTHING_PLAYABLE' };
      const result = await controller.play(target);
      return { target, result, wouldOpen: opened, wouldSendMediaKeys: mediaKeys };
    });
    await sleep(2500);
    await step('playbackAfterPlay', async () => summarizeState(await api.getPlaybackState()));
    report.playExchanges = exchanges.slice(before);
  }

  if (experiment && collection) {
    // Prøver afspilningsstrategier én ad gangen og stopper ved den første, der faktisk starter musikken.
    const devices = await api.getDevices();
    const hostname = os.hostname().toLowerCase();
    const device = devices.find((d) => d.name && d.name.toLowerCase() === hostname) || devices.find((d) => !d.is_restricted);
    const target = playTargetFor(collection);
    const playArgs = target && target.contextUri ? { contextUri: target.contextUri, position: target.position } : target && { uris: [target.trackUri] };
    report.experiments = [];
    const run = async (name, fn) => {
      const start = exchanges.length;
      let error = null;
      try {
        await fn();
      } catch (err) {
        error = { code: err.code, message: err.message };
      }
      await sleep(3000);
      let state = null;
      try {
        state = summarizeState(await api.getPlaybackState());
      } catch (err) {
        state = { error: err.code };
      }
      report.experiments.push({ name, error, state, exchanges: exchanges.slice(start) });
      return Boolean(state && state.isPlaying && state.track);
    };
    if (!device || !playArgs) {
      report.experiments.push({ name: 'no device or nothing to play' });
    } else {
      report.experimentDevice = `${device.name} (${device.type}), lokal pc: ${device.name.toLowerCase() === hostname}`;
      const which = (process.argv.find((a) => a.startsWith('--experiment=')) || '').split('=')[1] || 'cold';
      let strategies = [
        ['play with device_id', () => api.play({ ...playArgs, deviceId: device.id })],
        ['transfer (play:true) and play with device_id', async () => {
          await api.transferPlayback(device.id, true);
          await sleep(1500);
          await api.play({ ...playArgs, deviceId: device.id });
        }],
      ];
      if (which === 'pause-resume') {
        strategies = [
          ['pause', () => api.pause()],
          ['resume (no body)', () => api.resume(device.id)],
        ];
      }
      if (which === 'album' && target.trackUri) {
        // Spiller nummeret i albummets kontekst i stedet for som løs URI, ligesom et spotify:track:-link gør.
        const trackId = target.trackUri.split(':').pop();
        const raw = await api.request('GET', `/tracks/${trackId}`, { query: { market: 'from_token' } });
        report.trackInfo = {
          requestedId: trackId,
          returnedId: raw.id,
          isPlayable: raw.is_playable,
          restrictions: raw.restrictions || null,
          albumUri: raw.album && raw.album.uri,
          trackNumber: raw.track_number,
        };
        strategies = [
          ['album context with offset (uri)', () =>
            api.play({ contextUri: raw.album.uri, offsetUri: raw.uri, deviceId: device.id })],
        ];
      }
      for (const [name, fn] of strategies) {
        if (await run(name, fn)) break;
      }
    }
  }

  return report;
}

module.exports = { runDiagnose, playTargetFor };
