'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackController, buildPlayRequest } = require('../src/main/playback.js');
const { SpotifyError } = require('../src/main/errors.js');

/**
 * Falsk Spotify: som standard "spiller" den det, der sidst blev bedt om, så verifikationen lykkes.
 * Tests kan overskrive enkelte metoder, fx for at simulere at appen ignorerer kommandoen.
 */
function makeController({ loggedIn = true, api = {} } = {}) {
  const opened = [];
  const keys = [];
  const calls = [];
  let lastPlay = null;
  const record = (name, impl) => async (...args) => {
    calls.push([name, ...args]);
    return impl ? impl(...args) : undefined;
  };
  const fullApi = {
    play: record('play', async (request) => {
      const result = api.play ? await api.play(request) : undefined;
      lastPlay = request;
      return result;
    }),
    resume: record('resume', api.resume),
    pause: record('pause', api.pause),
    next: record('next', api.next),
    previous: record('previous', api.previous),
    seek: record('seek', api.seek),
    setVolume: record('setVolume', api.setVolume),
    getDevices: record('getDevices', api.getDevices || (() => [])),
    getPlaybackState: record(
      'getPlaybackState',
      api.getPlaybackState ||
        (() =>
          lastPlay && {
            isPlaying: true,
            contextUri: lastPlay.contextUri || null,
            item: { uri: lastPlay.offsetUri || (lastPlay.uris && lastPlay.uris[0]) || 'spotify:track:ukendt' },
          })
    ),
  };
  const controller = new PlaybackController({
    api: fullApi,
    auth: { isLoggedIn: () => loggedIn },
    openExternal: async (url) => {
      opened.push(url);
    },
    sendMediaKey: async (key) => {
      keys.push(key);
    },
    sleepImpl: async () => {},
    deviceWaitSeconds: 3,
    verifyAttempts: 4,
  });
  return { controller, opened, keys, calls, playCalls: () => calls.filter((c) => c[0] === 'play') };
}

test('buildPlayRequest bruger altid en kontekst, når det er muligt', () => {
  assert.deepEqual(buildPlayRequest({ contextUri: 'spotify:playlist:p', position: 3, trackUri: 'spotify:track:t' }), {
    contextUri: 'spotify:playlist:p',
    position: 3,
  });
  assert.deepEqual(buildPlayRequest({ contextUri: 'spotify:playlist:p', trackUri: 'spotify:track:t' }), {
    contextUri: 'spotify:playlist:p',
    offsetUri: 'spotify:track:t',
  });
  assert.deepEqual(buildPlayRequest({ contextUri: 'spotify:playlist:p' }), { contextUri: 'spotify:playlist:p' });
  // Et enkelt nummer afspilles i sit albums kontekst, ikke som løs "uris"-kommando.
  assert.deepEqual(buildPlayRequest({ trackUri: 'spotify:track:t', parentUri: 'spotify:album:a' }), {
    contextUri: 'spotify:album:a',
    offsetUri: 'spotify:track:t',
  });
  assert.deepEqual(buildPlayRequest({ trackUri: 'spotify:track:t' }), { uris: ['spotify:track:t'] });
});

test('uden login åbnes nummeret i Spotify-appen, og knapperne bliver medietaster', async () => {
  const { controller, opened, keys, calls } = makeController({ loggedIn: false });
  assert.deepEqual(await controller.play({ contextUri: 'spotify:playlist:p', position: 2, trackUri: 'spotify:track:t' }), { mode: 'external' });
  assert.deepEqual(opened, ['spotify:track:t']);
  await controller.control('next');
  await controller.control('toggle');
  assert.deepEqual(keys, ['next', 'playpause']);
  assert.equal(calls.length, 0);
});

test('afspilning starter i playlistens kontekst fra den rigtige position og verificeres', async () => {
  const { controller, playCalls, opened } = makeController();
  assert.deepEqual(await controller.play({ contextUri: 'spotify:playlist:p', position: 5, trackUri: 'spotify:track:t' }), { mode: 'api' });
  assert.deepEqual(playCalls(), [['play', { contextUri: 'spotify:playlist:p', position: 5 }]]);
  assert.deepEqual(opened, []);
  assert.equal(controller.premium, true);
});

test('et enkelt nummer afspilles i albummets kontekst', async () => {
  const { controller, playCalls } = makeController();
  assert.deepEqual(await controller.play({ trackUri: 'spotify:track:t', parentUri: 'spotify:album:a' }), { mode: 'api' });
  assert.deepEqual(playCalls(), [['play', { contextUri: 'spotify:album:a', offsetUri: 'spotify:track:t' }]]);
});

test('uden kendt position bruges nummerets URI som offset', async () => {
  const { controller, playCalls } = makeController();
  await controller.play({ contextUri: 'spotify:playlist:p', trackUri: 'spotify:track:t' });
  assert.deepEqual(playCalls()[0], ['play', { contextUri: 'spotify:playlist:p', offsetUri: 'spotify:track:t' }]);
});

test('ignorerer Spotify-appen kommandoen, åbnes nummeret direkte i appen', async () => {
  const { controller, opened, calls } = makeController({
    api: { getPlaybackState: () => ({ isPlaying: false, contextUri: null, item: null }) },
  });
  const result = await controller.play({ trackUri: 'spotify:track:t', parentUri: 'spotify:album:a' });
  assert.deepEqual(result, { mode: 'external', reason: 'APP_IGNORED_COMMAND' });
  assert.deepEqual(opened, ['spotify:track:t']);
  assert.equal(calls.filter((c) => c[0] === 'getPlaybackState').length, 4, 'venter hele verifikationsperioden');
});

test('en afspilning der først starter efter et øjeblik accepteres', async () => {
  let polls = 0;
  const { controller, opened } = makeController({
    api: {
      getPlaybackState: () => {
        polls += 1;
        return polls < 3 ? { isPlaying: false, item: null } : { isPlaying: true, contextUri: 'spotify:album:a', item: { uri: 'spotify:track:t' } };
      },
    },
  });
  assert.deepEqual(await controller.play({ trackUri: 'spotify:track:t', parentUri: 'spotify:album:a' }), { mode: 'api' });
  assert.deepEqual(opened, []);
});

test('uden aktiv enhed startes Spotify-appen, og der ventes på den', async () => {
  let playAttempts = 0;
  let deviceLookups = 0;
  const { controller, opened, playCalls } = makeController({
    api: {
      play: () => {
        playAttempts += 1;
        if (playAttempts === 1) throw new SpotifyError('NO_ACTIVE_DEVICE', 'ingen');
      },
      getDevices: () => {
        deviceLookups += 1;
        return deviceLookups < 3 ? [] : [{ id: 'pc', name: 'PETER-PC', type: 'Computer', is_active: false }];
      },
    },
  });
  const result = await controller.play({ trackUri: 'spotify:track:t', parentUri: 'spotify:album:a' });
  assert.deepEqual(result, { mode: 'api', device: 'PETER-PC' });
  assert.deepEqual(opened, ['spotify:']);
  assert.deepEqual(playCalls().at(-1), ['play', { contextUri: 'spotify:album:a', offsetUri: 'spotify:track:t', deviceId: 'pc' }]);
});

test('giver op med en forståelig fejl, hvis Spotify-appen aldrig dukker op', async () => {
  const { controller } = makeController({
    api: {
      play: () => {
        throw new SpotifyError('NO_ACTIVE_DEVICE', 'ingen');
      },
    },
  });
  await assert.rejects(controller.play({ trackUri: 'spotify:track:t' }), { code: 'NO_ACTIVE_DEVICE' });
});

test('uden Premium falder afspilning tilbage til appen og knapperne til medietaster', async () => {
  const { controller, opened, keys, calls } = makeController({
    api: {
      play: () => {
        throw new SpotifyError('PREMIUM_REQUIRED', 'premium');
      },
    },
  });
  const result = await controller.play({ contextUri: 'spotify:playlist:p', position: 0, trackUri: 'spotify:track:t' });
  assert.deepEqual(result, { mode: 'external', reason: 'PREMIUM_REQUIRED' });
  assert.deepEqual(opened, ['spotify:track:t']);
  assert.equal(controller.premium, false);
  calls.length = 0;
  assert.deepEqual(await controller.control('next'), { mode: 'mediakey' });
  assert.deepEqual(keys, ['next']);
  assert.equal(calls.length, 0, 'API kaldes ikke igen, når Premium mangler');
  await assert.rejects(controller.seek(1000), { code: 'PREMIUM_REQUIRED' });
});

test('stop pauser og spoler til start, også når der allerede er pauset', async () => {
  const { controller, calls } = makeController({
    api: {
      pause: () => {
        throw new SpotifyError('COMMAND_REJECTED', 'allerede pauset');
      },
    },
  });
  await controller.control('stop');
  assert.deepEqual(calls.map((c) => c[0]), ['pause', 'seek']);
  assert.deepEqual(calls[1], ['seek', 0]);
});

test('toggle pauser, når der spilles, og fortsætter ellers', async () => {
  let playing = true;
  const { controller, calls } = makeController({ api: { getPlaybackState: () => ({ isPlaying: playing }) } });
  await controller.control('toggle');
  playing = false;
  await controller.control('toggle');
  assert.deepEqual(calls.map((c) => c[0]), ['getPlaybackState', 'pause', 'getPlaybackState', 'resume']);
});

test('ukendte handlinger afvises', async () => {
  const { controller } = makeController();
  await assert.rejects(controller.control('selvdestruer'), { code: 'UNSUPPORTED' });
});
