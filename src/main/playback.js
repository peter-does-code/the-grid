'use strict';

const { SpotifyError } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fallback, når Web API-styring ikke er mulig: Windows' medietaster virker på Spotify-appen (og de fleste afspillere).
const MEDIA_KEY_FOR = {
  play: 'playpause',
  pause: 'playpause',
  toggle: 'playpause',
  restart: 'previous',
  next: 'next',
  previous: 'previous',
  stop: 'stop',
};

/**
 * Bygger afspil-forespørgslen. Der bruges altid en kontekst, når det er muligt:
 * Spotify-appen til Windows tømmer afspilleren i stedet for at spille, når den får en løs
 * "uris"-kommando, mens kontekst + offset virker (verificeret 29-09-2026 med app 1.301.234.0).
 * Et enkelt nummer afspilles derfor i sit albums kontekst, en episode i sit shows.
 */
function buildPlayRequest({ contextUri, position, trackUri, parentUri }) {
  if (contextUri) {
    if (Number.isInteger(position)) return { contextUri, position };
    return trackUri ? { contextUri, offsetUri: trackUri } : { contextUri };
  }
  if (parentUri && trackUri) return { contextUri: parentUri, offsetUri: trackUri };
  return { uris: [trackUri] };
}

/**
 * Samler logikken for at starte og styre afspilning:
 * Web API når brugeren er logget ind (kræver Premium), ellers Spotify-appen via links og medietaster.
 */
class PlaybackController {
  constructor({
    api,
    auth,
    openExternal,
    sendMediaKey,
    sleepImpl = sleep,
    deviceWaitSeconds = 10,
    verifyAttempts = 8,
    verifyIntervalMs = 500,
  }) {
    this.api = api;
    this.auth = auth;
    this.openExternal = openExternal;
    this.sendMediaKey = sendMediaKey;
    this.sleepImpl = sleepImpl;
    this.deviceWaitSeconds = deviceWaitSeconds;
    this.verifyAttempts = verifyAttempts;
    this.verifyIntervalMs = verifyIntervalMs;
    this.premium = null; // null = ukendt, true/false når Spotify har svaret på en afspillerkommando
  }

  canUseApi() {
    return this.auth.isLoggedIn() && this.premium !== false;
  }

  /**
   * Starter et nummer i playlistens/albummets kontekst, så Spotify selv fortsætter med de næste numre.
   * @param {{contextUri?: string, position?: number, trackUri?: string, parentUri?: string}} target
   */
  async play({ contextUri, position, trackUri, parentUri } = {}) {
    if (!contextUri && !trackUri) throw new SpotifyError('NOTHING_TO_PLAY', 'Choose a track first.');
    const direct = trackUri || contextUri;

    if (!this.canUseApi()) {
      await this.openExternal(direct);
      return { mode: 'external' };
    }

    const request = buildPlayRequest({ contextUri, position, trackUri, parentUri });
    let device = null;
    try {
      await this.api.play(request);
    } catch (err) {
      if (err.code === 'PREMIUM_REQUIRED') {
        this.premium = false;
        await this.openExternal(direct);
        return { mode: 'external', reason: 'PREMIUM_REQUIRED' };
      }
      if (err.code !== 'NO_ACTIVE_DEVICE') throw err;
      device = await this.findOrStartDevice();
      await this.api.play({ ...request, deviceId: device.id });
    }
    this.premium = true;

    if (await this.verifyPlaying({ contextUri: request.contextUri, trackUri })) {
      return device ? { mode: 'api', device: device.name } : { mode: 'api' };
    }
    // Spotify tog imod kommandoen, men appen startede ikke afspilningen. Et spotify:-link virker altid lokalt.
    await this.openExternal(direct);
    return { mode: 'external', reason: 'APP_IGNORED_COMMAND' };
  }

  /** Venter på, at Spotify faktisk spiller det ønskede nummer eller den ønskede kontekst. */
  async verifyPlaying({ contextUri, trackUri }) {
    for (let attempt = 0; attempt < this.verifyAttempts; attempt++) {
      await this.sleepImpl(this.verifyIntervalMs);
      let state = null;
      try {
        state = await this.api.getPlaybackState();
      } catch {
        continue;
      }
      if (!state || !state.item || !state.isPlaying) continue;
      if ((trackUri && state.item.uri === trackUri) || (contextUri && state.contextUri === contextUri)) return true;
    }
    return false;
  }

  async pickDevice() {
    const devices = await this.api.getDevices();
    return (
      devices.find((d) => d.is_active) ||
      devices.find((d) => d.type === 'Computer' && !d.is_restricted) ||
      devices.find((d) => !d.is_restricted) ||
      null
    );
  }

  /** Finder en Spotify-afspiller, og starter Spotify-appen hvis der ingen er. */
  async findOrStartDevice() {
    let device = await this.pickDevice();
    if (device) return device;
    await this.openExternal('spotify:');
    for (let attempt = 0; attempt < this.deviceWaitSeconds && !device; attempt++) {
      await this.sleepImpl(1000);
      device = await this.pickDevice();
    }
    if (!device) {
      throw new SpotifyError('NO_ACTIVE_DEVICE', 'The Spotify app is not responding. Start Spotify and try again.');
    }
    return device;
  }

  /** @param {'play'|'pause'|'toggle'|'restart'|'next'|'previous'|'stop'} action */
  async control(action) {
    const mediaKey = MEDIA_KEY_FOR[action];
    if (!mediaKey) throw new SpotifyError('UNSUPPORTED', `Unknown action: ${action}`);

    if (this.canUseApi()) {
      try {
        await this.apiControl(action);
        this.premium = true;
        return { mode: 'api' };
      } catch (err) {
        if (err.code === 'PREMIUM_REQUIRED') this.premium = false;
        // Uden aktiv enhed kan medietasterne stadig nå en åben Spotify-app.
        else if (err.code !== 'NO_ACTIVE_DEVICE') throw err;
      }
    }
    await this.sendMediaKey(mediaKey);
    return { mode: 'mediakey' };
  }

  async apiControl(action) {
    switch (action) {
      case 'play':
        return this.api.resume();
      case 'pause':
        return this.api.pause();
      case 'toggle': {
        const state = await this.api.getPlaybackState();
        return state && state.isPlaying ? this.api.pause() : this.api.resume();
      }
      case 'restart':
        return this.api.seek(0);
      case 'next':
        return this.api.next();
      case 'previous':
        return this.api.previous();
      case 'stop':
        // Winamp-stop: pause og spol til start. Pause fejler, hvis der allerede er pauset; det er ok.
        try {
          await this.api.pause();
        } catch (err) {
          if (err.code !== 'COMMAND_REJECTED') throw err;
        }
        return this.api.seek(0);
      default:
        throw new SpotifyError('UNSUPPORTED', `Unknown action: ${action}`);
    }
  }

  async seek(positionMs) {
    this.requireApi();
    return this.api.seek(positionMs);
  }

  async setVolume(percent) {
    this.requireApi();
    return this.api.setVolume(percent);
  }

  requireApi() {
    if (!this.auth.isLoggedIn()) throw new SpotifyError('NOT_LOGGED_IN', 'Log in with Spotify to use this.');
    if (this.premium === false) throw new SpotifyError('PREMIUM_REQUIRED', 'This requires Spotify Premium.');
  }
}

module.exports = { PlaybackController, MEDIA_KEY_FOR, buildPlayRequest };
