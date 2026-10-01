'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SpotifyApi } = require('../src/main/spotify-api.js');
const { response, fakeFetch, rawTrack } = require('./helpers.js');

const ID = '37i9dQZF1DXcBWIGoYBM5M';

function makeApi(routes, { tokens } = {}) {
  const fetchImpl = fakeFetch(routes);
  const tokenCalls = [];
  const sleeps = [];
  const api = new SpotifyApi({
    fetchImpl,
    getAccessToken: async (opts = {}) => {
      tokenCalls.push(opts);
      return tokens ? tokens.shift() : 'token';
    },
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { api, fetchImpl, tokenCalls, sleeps };
}

test('henter en egen playliste i det nye format (items/item) med sideskift', async () => {
  const { api, fetchImpl } = makeApi({
    [`GET /v1/playlists/${ID}`]: response(200, {
      id: ID,
      uri: `spotify:playlist:${ID}`,
      name: 'Min liste',
      owner: { display_name: 'Peter' },
      images: [{ url: 'https://i.scdn.co/stor', width: 640 }, { url: 'https://i.scdn.co/lille', width: 60 }],
      items: {
        total: 3,
        items: [{ item: rawTrack('a') }, { item: null }],
        next: `https://api.spotify.com/v1/playlists/${ID}/items?offset=2&limit=2`,
      },
    }),
    [`GET /v1/playlists/${ID}/items`]: response(200, { items: [{ item: rawTrack('c') }], next: null }),
  });
  const progress = [];
  const result = await api.getCollection({ type: 'playlist', id: ID }, { onProgress: (p) => progress.push(p) });
  assert.equal(result.name, 'Min liste');
  assert.equal(result.owner, 'Peter');
  assert.equal(result.imageUrl, 'https://i.scdn.co/stor');
  assert.equal(result.itemsRestricted, false);
  assert.equal(result.total, 3);
  // Det tomme element springes over, men positionerne følger Spotifys rækkefølge.
  assert.deepEqual(result.tracks.map((t) => [t.id, t.position]), [['a', 0], ['c', 2]]);
  assert.equal(result.tracks[0].parentUri, 'spotify:album:alb');
  assert.deepEqual(progress, [{ loaded: 2, total: 3 }, { loaded: 3, total: 3 }]);
  assert.equal(fetchImpl.calls[0].url.searchParams.get('market'), 'from_token');
});

test('forstår også det gamle format (tracks/track)', async () => {
  const { api } = makeApi({
    [`GET /v1/playlists/${ID}`]: response(200, {
      id: ID,
      uri: `spotify:playlist:${ID}`,
      name: 'Gammel',
      owner: { id: 'x' },
      tracks: { total: 1, items: [{ track: rawTrack('a') }], next: null },
    }),
  });
  const result = await api.getPlaylist(ID);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.owner, 'x');
});

test('andres playlister giver kun metadata og markeres som begrænset', async () => {
  const { api } = makeApi({
    [`GET /v1/playlists/${ID}`]: response(200, { id: ID, uri: `spotify:playlist:${ID}`, name: 'Andens', owner: { display_name: 'Anden' } }),
  });
  const result = await api.getPlaylist(ID);
  assert.equal(result.itemsRestricted, true);
  assert.deepEqual(result.tracks, []);
});

test('album-numre får albumnavnet med', async () => {
  const { api } = makeApi({
    [`GET /v1/albums/${ID}`]: response(200, {
      id: ID,
      uri: `spotify:album:${ID}`,
      name: 'Pladen',
      artists: [{ name: 'Band' }],
      tracks: { total: 2, items: [rawTrack('a', { album: undefined }), rawTrack('b', { album: undefined })], next: null },
    }),
  });
  const result = await api.getCollection({ type: 'album', id: ID });
  assert.equal(result.owner, 'Band');
  assert.deepEqual(result.tracks.map((t) => t.album), ['Pladen', 'Pladen']);
  assert.deepEqual(result.tracks.map((t) => t.parentUri), [`spotify:album:${ID}`, `spotify:album:${ID}`]);
});

test('episoder, lokale filer og utilgængelige numre normaliseres', async () => {
  const { api } = makeApi({
    [`GET /v1/playlists/${ID}`]: response(200, {
      id: ID,
      uri: `spotify:playlist:${ID}`,
      name: 'Blandet',
      items: {
        total: 3,
        items: [
          { item: { type: 'episode', id: 'e', uri: 'spotify:episode:e', name: 'Afsnit', show: { name: 'Podcast', uri: 'spotify:show:s' }, duration_ms: 1000 } },
          { item: rawTrack('l', { is_local: true, id: null, uri: 'spotify:local:x' }) },
          { item: rawTrack('u', { is_playable: false }) },
        ],
        next: null,
      },
    }),
  });
  const [episode, local, unavailable] = (await api.getPlaylist(ID)).tracks;
  assert.deepEqual([episode.type, episode.artists, episode.playable, episode.parentUri], ['episode', ['Podcast'], true, 'spotify:show:s']);
  assert.equal(local.playable, false);
  assert.equal(unavailable.playable, false);
});

test('401 fornyer tokenet og prøver igen én gang', async () => {
  const { api, tokenCalls } = makeApi(
    { 'GET /v1/me': [response(401, { error: { status: 401, message: 'expired' } }), response(200, { id: 'peter' })] },
    { tokens: ['gammelt', 'nyt'] }
  );
  assert.deepEqual(await api.getMe(), { id: 'peter' });
  assert.deepEqual(tokenCalls, [{ forceRefresh: false }, { forceRefresh: true }]);
});

test('fejlsvar oversættes til koder', async () => {
  const cases = [
    [`GET /v1/playlists/${ID}`, response(404, { error: { status: 404, message: 'Not found' } }), 'PLAYLIST_NOT_FOUND', () => (a) => a.getPlaylist(ID)],
    ['PUT /v1/me/player/play', response(403, { error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } }), 'PREMIUM_REQUIRED', () => (a) => a.play({ uris: ['spotify:track:a'] })],
    ['PUT /v1/me/player/play', response(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }), 'NO_ACTIVE_DEVICE', () => (a) => a.play({})],
    ['PUT /v1/me/player/pause', response(403, { error: { status: 403, message: 'Player command failed: Restriction violated', reason: 'UNKNOWN' } }), 'COMMAND_REJECTED', () => (a) => a.pause()],
    ['GET /v1/me', response(403, { error: { status: 403, message: 'User not registered in the Developer Dashboard' } }), 'USER_NOT_REGISTERED', () => (a) => a.getMe()],
    ['GET /v1/me', response(429, { error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } }, { 'Retry-After': '3600' }), 'QUOTA_EXCEEDED', () => (a) => a.getMe()],
  ];
  for (const [route, res, code, getCall] of cases) {
    const { api } = makeApi({ [route]: res });
    await assert.rejects(getCall()(api), { code }, `${route} → ${code}`);
  }
});

test('404 på en playliste forklarer Spotifys begrænsninger', async () => {
  const { api } = makeApi({ [`GET /v1/playlists/${ID}`]: response(404, { error: { status: 404, message: 'Not found' } }) });
  await assert.rejects(api.getPlaylist(ID), (err) => err.code === 'PLAYLIST_NOT_FOUND' && /editorial/.test(err.message));
});

test('kort 429 venter Retry-After og prøver igen', async () => {
  const { api, sleeps } = makeApi({
    'GET /v1/me': [response(429, {}, { 'Retry-After': '2' }), response(200, { id: 'peter' })],
  });
  assert.deepEqual(await api.getMe(), { id: 'peter' });
  assert.deepEqual(sleeps, [2000]);
});

test('play bygger den rigtige body', async () => {
  const { api, fetchImpl } = makeApi({ 'PUT /v1/me/player/play': response(204) });
  await api.play({ contextUri: 'spotify:playlist:p', position: 4 });
  await api.play({ contextUri: 'spotify:playlist:p', offsetUri: 'spotify:track:t', deviceId: 'd1' });
  await api.play({ uris: ['spotify:track:t'] });
  await api.play({ contextUri: 'spotify:playlist:p' });
  const bodies = fetchImpl.calls.map((c) => c.body);
  assert.deepEqual(bodies[0], { context_uri: 'spotify:playlist:p', position_ms: 0, offset: { position: 4 } });
  assert.deepEqual(bodies[1], { context_uri: 'spotify:playlist:p', position_ms: 0, offset: { uri: 'spotify:track:t' } });
  assert.equal(fetchImpl.calls[1].url.searchParams.get('device_id'), 'd1');
  assert.deepEqual(bodies[2], { uris: ['spotify:track:t'], position_ms: 0 });
  assert.deepEqual(bodies[3], { context_uri: 'spotify:playlist:p', position_ms: 0 });
});

test('afspillerstatus er null, når intet spiller (204)', async () => {
  const { api } = makeApi({ 'GET /v1/me/player': response(204) });
  assert.equal(await api.getPlaybackState(), null);
});

test('afspillerstatus og kø normaliseres', async () => {
  const { api } = makeApi({
    'GET /v1/me/player': response(200, {
      is_playing: true,
      progress_ms: 1234,
      context: { uri: 'spotify:playlist:p' },
      device: { id: 'd', name: 'PETER-PC', type: 'Computer', volume_percent: 55, supports_volume: true },
      item: rawTrack('a'),
    }),
    'GET /v1/me/player/queue': response(200, { currently_playing: rawTrack('a'), queue: [rawTrack('b'), rawTrack('c')] }),
  });
  const state = await api.getPlaybackState();
  assert.equal(state.isPlaying, true);
  assert.equal(state.progressMs, 1234);
  assert.equal(state.device.volumePercent, 55);
  assert.equal(state.item.id, 'a');
  const queue = await api.getQueue();
  assert.equal(queue.currentlyPlaying.id, 'a');
  assert.deepEqual(queue.queue.map((t) => t.id), ['b', 'c']);
});

test('søgning finder det første afspillelige nummer', async () => {
  const { api, fetchImpl } = makeApi({
    'GET /v1/search': response(200, {
      tracks: { items: [rawTrack('lokal', { is_local: true }), rawTrack('hlah'), rawTrack('closer')] },
    }),
  });
  const track = await api.searchTrack('Head Like a Hole Nine Inch Nails');
  assert.equal(track.id, 'hlah');
  // market=from_token kræver et scope, appen ikke har (Spotify svarede 403 "Insufficient client scope", 30-09-2026).
  const call = fetchImpl.calls.find((c) => c.key === 'GET /v1/search');
  assert.equal(call.url.searchParams.get('market'), null);
  assert.equal(call.url.searchParams.get('type'), 'track');
  assert.ok(track.parentUri, 'albummet følger med, så nummeret kan spilles i sin kontekst');
});

test('søgning uden resultater giver null', async () => {
  const { api } = makeApi({ 'GET /v1/search': response(200, { tracks: { items: [] } }) });
  assert.equal(await api.searchTrack('findes ikke'), null);
});
