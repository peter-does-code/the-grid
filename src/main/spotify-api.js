'use strict';

const { SpotifyError } = require('./errors');

const API_BASE = 'https://api.spotify.com/v1';
const MAX_RETRY_AFTER_SECONDS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Omsætter et Spotify-fejlsvar til en fejl med kode og en dansk forklaring. */
function toSpotifyError(status, data, path) {
  const apiMessage =
    (data && data.error && typeof data.error === 'object' && data.error.message) ||
    (data && typeof data.error === 'string' && data.error) ||
    '';
  const reason = (data && data.error && data.error.reason) || '';
  const isPlayer = path.includes('/me/player');

  if (reason === 'PREMIUM_REQUIRED' || (status === 403 && isPlayer && /premium/i.test(apiMessage))) {
    return new SpotifyError('PREMIUM_REQUIRED', 'Controlling playback requires Spotify Premium.', { status });
  }
  if (reason === 'NO_ACTIVE_DEVICE' || (status === 404 && isPlayer)) {
    return new SpotifyError('NO_ACTIVE_DEVICE', 'No active Spotify player. Open the Spotify app and try again.', { status });
  }
  if (status === 401) {
    return new SpotifyError('NOT_LOGGED_IN', 'The Spotify login has expired. Log in again under Settings.', { status });
  }
  if (status === 403 && /not registered|user.*not.*(allowed|added)|developer dashboard/i.test(apiMessage)) {
    return new SpotifyError(
      'USER_NOT_REGISTERED',
      'Your Spotify account is not added under "User Management" for the app on the Spotify Developer Dashboard.',
      { status }
    );
  }
  if (status === 403 && isPlayer) {
    // Typisk "Player command failed: Restriction violated", fx pause mens der allerede er pauset.
    return new SpotifyError('COMMAND_REJECTED', 'Spotify afviste kommandoen lige nu.', { status });
  }
  if (status === 403 && path.includes('/playlists/') && (path.endsWith('/items') || path.endsWith('/tracks'))) {
    return new SpotifyError(
      'PLAYLIST_ITEMS_RESTRICTED',
      'Spotify only hands over the track list for playlists you own or collaborate on.',
      { status }
    );
  }
  if (status === 404 && path.includes('/playlists/')) {
    return new SpotifyError(
      'PLAYLIST_NOT_FOUND',
      'Spotify could not find the playlist. Private playlists must be your own, and Spotify\'s own editorial and ' +
        'algorithmic playlists (such as Discover Weekly and Today\'s Top Hits) cannot be loaded by developer apps.',
      { status }
    );
  }
  if (status === 404) {
    return new SpotifyError('NOT_FOUND', 'Spotify could not find it. Check the link.', { status });
  }
  if (status === 429 && reason === 'QUOTA_EXCEEDED') {
    return new SpotifyError(
      'QUOTA_EXCEEDED',
      'The Spotify quota for the developer account is used up for now. Wait a bit and try again.',
      { status }
    );
  }
  if (status === 429) {
    return new SpotifyError('RATE_LIMITED', 'Spotify asks us to wait. Try again in a moment.', { status });
  }
  const detail = `${status}${apiMessage ? `: ${apiMessage}` : ''}`;
  return new SpotifyError('HTTP_ERROR', `Spotify answered ${detail}`, { status, detail });
}

/**
 * Ensartet repræsentation af et nummer eller en podcast-episode.
 * `position` er placeringen i Spotifys egen rækkefølge (inkl. utilgængelige numre),
 * så den kan bruges direkte som offset, når afspilning startes i playlistens kontekst.
 */
function normalizeTrack(raw, position) {
  if (!raw) return null;
  const isEpisode = raw.type === 'episode';
  const artists = isEpisode
    ? raw.show && raw.show.name
      ? [raw.show.name]
      : []
    : (raw.artists || []).map((a) => a && a.name).filter(Boolean);
  const isLocal = Boolean(raw.is_local);
  return {
    position,
    id: raw.id || null,
    uri: raw.uri || null,
    name: raw.name || '(unknown title)',
    artists,
    album: isEpisode ? (raw.show && raw.show.name) || '' : (raw.album && raw.album.name) || '',
    // Albummet (eller showet for en episode). Bruges som kontekst, når et enkelt nummer afspilles.
    parentUri: isEpisode ? (raw.show && raw.show.uri) || null : (raw.album && raw.album.uri) || null,
    durationMs: Number(raw.duration_ms) || 0,
    isLocal,
    playable: raw.is_playable !== false && !isLocal && Boolean(raw.uri),
    type: isEpisode ? 'episode' : 'track',
  };
}

/** Vælger et billede omkring 300 px, ellers det største. */
function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  const good = sorted.find((img) => (img.width || 300) >= 200) || sorted[sorted.length - 1];
  return (good && good.url) || null;
}

class SpotifyApi {
  /**
   * @param {object} deps
   * @param {(opts?: {forceRefresh?: boolean}) => Promise<string>} deps.getAccessToken
   * @param {typeof fetch} [deps.fetchImpl]
   * @param {(ms: number) => Promise<void>} [deps.sleepImpl]
   */
  constructor({ getAccessToken, fetchImpl = globalThis.fetch, sleepImpl = sleep }) {
    this.getAccessToken = getAccessToken;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
  }

  async request(method, pathOrUrl, { query, body, retried401 = false, retried429 = false } = {}) {
    const url = new URL(pathOrUrl.startsWith('https://') ? pathOrUrl : API_BASE + pathOrUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }
    const token = await this.getAccessToken({ forceRefresh: retried401 });
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new SpotifyError('NETWORK', `Could not reach Spotify: ${err.message}`, { detail: err.message });
    }

    if (res.status === 401 && !retried401) {
      return this.request(method, pathOrUrl, { query, body, retried401: true, retried429 });
    }
    if (res.status === 429 && !retried429) {
      const wait = Number(res.headers.get('retry-after')) || 1;
      if (wait <= MAX_RETRY_AFTER_SECONDS) {
        await this.sleepImpl(wait * 1000);
        return this.request(method, pathOrUrl, { query, body, retried401, retried429: true });
      }
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null; // Nogle afspiller-endpoints svarer med tom eller ikke-JSON body.
      }
    }
    if (res.ok) return data;
    throw toSpotifyError(res.status, data, url.pathname);
  }

  getMe() {
    return this.request('GET', '/me');
  }

  getCollection(ref, { onProgress } = {}) {
    if (ref.type === 'playlist') return this.getPlaylist(ref.id, { onProgress });
    if (ref.type === 'album') return this.getAlbum(ref.id, { onProgress });
    if (ref.type === 'track') return this.getSingleTrack(ref.id);
    return Promise.reject(new SpotifyError('UNSUPPORTED', 'Only playlists, albums and tracks can be loaded.'));
  }

  async getPlaylist(id, { onProgress } = {}) {
    const playlist = await this.request('GET', `/playlists/${encodeURIComponent(id)}`, {
      query: { market: 'from_token', additional_types: 'track,episode' },
    });
    // Siden februar 2026 hedder feltet "items" (før "tracks"), og hvert element har "item" (før "track").
    // For playlister, brugeren hverken ejer eller samarbejder om, mangler feltet helt: kun metadata.
    const firstPage = playlist.items || playlist.tracks || null;
    const itemsRestricted = !firstPage;
    const total = (firstPage && firstPage.total) || 0;
    const tracks = [];
    let position = 0;
    let page = firstPage;
    while (page) {
      for (const entry of page.items || []) {
        const track = normalizeTrack(entry && (entry.item || entry.track), position);
        position += 1;
        if (track) tracks.push(track);
      }
      if (onProgress) onProgress({ loaded: position, total });
      page = page.next ? await this.request('GET', page.next) : null;
    }
    return {
      type: 'playlist',
      id: playlist.id,
      uri: playlist.uri,
      name: playlist.name || 'Playliste',
      owner: (playlist.owner && (playlist.owner.display_name || playlist.owner.id)) || '',
      imageUrl: pickImage(playlist.images),
      total,
      tracks,
      itemsRestricted,
    };
  }

  async getAlbum(id, { onProgress } = {}) {
    const album = await this.request('GET', `/albums/${encodeURIComponent(id)}`, { query: { market: 'from_token' } });
    const total = (album.tracks && album.tracks.total) || 0;
    const tracks = [];
    let position = 0;
    let page = album.tracks || null;
    while (page) {
      for (const raw of page.items || []) {
        const track = normalizeTrack(raw && { ...raw, album: { name: album.name, uri: album.uri } }, position);
        position += 1;
        if (track) tracks.push(track);
      }
      if (onProgress) onProgress({ loaded: position, total });
      page = page.next ? await this.request('GET', page.next) : null;
    }
    return {
      type: 'album',
      id: album.id,
      uri: album.uri,
      name: album.name || 'Album',
      owner: (album.artists || []).map((a) => a.name).join(', '),
      imageUrl: pickImage(album.images),
      total,
      tracks,
    };
  }

  /** Første afspillelige nummer, der matcher søgningen (bruges af påskeægget "drew"). */
  async searchTrack(query) {
    const data = await this.request('GET', '/search', { query: { q: String(query).slice(0, 200), type: 'track', limit: 5 } });
    const items = (data && data.tracks && data.tracks.items) || [];
    return items.map((raw) => normalizeTrack(raw, 0)).find((track) => track && track.playable) || null;
  }

  async getSingleTrack(id) {
    const raw = await this.request('GET', `/tracks/${encodeURIComponent(id)}`, { query: { market: 'from_token' } });
    const track = normalizeTrack(raw, 0);
    return {
      type: 'track',
      id: raw.id,
      uri: raw.uri,
      name: raw.name,
      owner: track.artists.join(', '),
      imageUrl: pickImage(raw.album && raw.album.images),
      total: 1,
      tracks: [track],
    };
  }

  async getDevices() {
    const data = await this.request('GET', '/me/player/devices');
    return (data && data.devices) || [];
  }

  /**
   * Starter afspilning i en kontekst (playliste/album) fra en position eller et nummers URI,
   * eller afspiller en liste af URI'er uden kontekst.
   */
  play({ deviceId, contextUri, position, offsetUri, uris } = {}) {
    let body = {};
    if (contextUri) {
      body = { context_uri: contextUri, position_ms: 0 };
      if (Number.isInteger(position)) body.offset = { position };
      else if (offsetUri) body.offset = { uri: offsetUri };
    } else if (Array.isArray(uris) && uris.length) {
      body = { uris, position_ms: 0 };
    }
    return this.request('PUT', '/me/player/play', { query: { device_id: deviceId }, body });
  }

  resume(deviceId) {
    return this.request('PUT', '/me/player/play', { query: { device_id: deviceId } });
  }

  /** Flytter afspilningen til en bestemt enhed (Spotify Connect). */
  transferPlayback(deviceId, play = false) {
    return this.request('PUT', '/me/player', { body: { device_ids: [deviceId], play } });
  }

  pause() {
    return this.request('PUT', '/me/player/pause');
  }

  next() {
    return this.request('POST', '/me/player/next');
  }

  previous() {
    return this.request('POST', '/me/player/previous');
  }

  seek(positionMs) {
    return this.request('PUT', '/me/player/seek', { query: { position_ms: Math.max(0, Math.round(positionMs)) } });
  }

  setVolume(percent) {
    const volume = Math.max(0, Math.min(100, Math.round(percent)));
    return this.request('PUT', '/me/player/volume', { query: { volume_percent: volume } });
  }

  /** Det der spiller nu og de næste numre i Spotifys kø (inkl. resten af den aktive playliste). */
  async getQueue() {
    const data = await this.request('GET', '/me/player/queue');
    if (!data) return { currentlyPlaying: null, queue: [] };
    return {
      currentlyPlaying: normalizeTrack(data.currently_playing, null),
      queue: (data.queue || []).map((raw, i) => normalizeTrack(raw, i)).filter(Boolean),
    };
  }

  async getPlaybackState() {
    const data = await this.request('GET', '/me/player', {
      query: { additional_types: 'episode', market: 'from_token' },
    });
    if (!data) return null;
    return {
      isPlaying: Boolean(data.is_playing),
      progressMs: Number(data.progress_ms) || 0,
      contextUri: (data.context && data.context.uri) || null,
      device: data.device
        ? {
            id: data.device.id,
            name: data.device.name,
            type: data.device.type,
            volumePercent: data.device.volume_percent,
            supportsVolume: data.device.supports_volume !== false,
          }
        : null,
      item: normalizeTrack(data.item, null),
    };
  }
}

module.exports = { SpotifyApi, normalizeTrack, pickImage, toSpotifyError, API_BASE };
