'use strict';

const http = require('node:http');
const { generateCodeVerifier, codeChallengeS256, generateState } = require('./pkce');
const { SpotifyError } = require('./errors');
const i18n = require('../shared/i18n');

// Spotify kræver en præcis registreret redirect-URI. Loopback-IP (ikke "localhost") over http er tilladt.
const REDIRECT_HOST = '127.0.0.1';
const DEFAULT_PORT = 43117;
const REDIRECT_PATH = '/callback';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
];
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const EXPIRY_SKEW_MS = 60 * 1000;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function redirectUriFor(port) {
  return `http://${REDIRECT_HOST}:${port}${REDIRECT_PATH}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Siden, browseren viser efter login: Tron-grid og cyan neon. */
function callbackPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${i18n.APP_NAME}</title>
<style>body{margin:0;display:grid;place-items:center;height:100vh;color:#bff;font:18px/1.5 Consolas,monospace;
background:#02060a linear-gradient(rgba(0,229,255,.12) 1px,transparent 1px) 0 0/40px 40px,linear-gradient(90deg,rgba(0,229,255,.12) 1px,#02060a 1px) 0 0/40px 40px}
main{border:2px solid #00e5ff;box-shadow:0 0 24px rgba(0,229,255,.6),inset 0 0 18px rgba(0,229,255,.25);padding:28px 36px;background:rgba(0,8,14,.92);max-width:540px}
h1{color:#00e5ff;letter-spacing:.35em;font-size:20px;margin:0 0 10px;text-shadow:0 0 8px #00e5ff}small{color:#ff9a3c}</style>
</head><body><main><h1>THE GRID</h1><p>${escapeHtml(message)}</p><small>END OF LINE</small></main></body></html>`;
}

class SpotifyAuth {
  /**
   * @param {object} deps
   * @param {() => string} deps.getClientId
   * @param {{load(): object|null, save(t: object): void, clear(): void}} deps.tokenStore
   * @param {(url: string) => any} deps.openExternal
   * @param {typeof fetch} [deps.fetchImpl]
   * @param {number} [deps.port]
   */
  constructor({ getClientId, tokenStore, openExternal, fetchImpl = globalThis.fetch, port = DEFAULT_PORT }) {
    this.getClientId = getClientId;
    this.tokenStore = tokenStore;
    this.openExternal = openExternal;
    this.fetchImpl = fetchImpl;
    this.port = port;
    this.pendingLogin = null;
    this.refreshing = null;
  }

  get redirectUri() {
    return redirectUriFor(this.port);
  }

  isLoggedIn() {
    const tokens = this.tokenStore.load();
    return Boolean(tokens && tokens.refreshToken);
  }

  /** Starter login i brugerens browser og venter på Spotifys svar på loopback-adressen. */
  login() {
    if (this.pendingLogin) {
      this.openExternal(this.pendingLogin.url);
      return this.pendingLogin.promise;
    }
    const clientId = this.getClientId();
    if (!clientId) {
      return Promise.reject(new SpotifyError('NOT_CONFIGURED', 'Enter a Spotify Client ID under Settings first.'));
    }

    const verifier = generateCodeVerifier();
    const state = generateState();
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES.join(' '),
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallengeS256(verifier),
      state,
    }).toString();
    const authorizeUrl = url.toString();

    const promise = new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;

      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingLogin = null;
        server.close();
        // Giv browseren tid til at modtage svarsiden, før keep-alive-forbindelser lukkes.
        const closer = setTimeout(() => server.closeAllConnections && server.closeAllConnections(), 500);
        if (closer.unref) closer.unref();
        if (err) reject(err);
        else resolve(value);
      };

      const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, this.redirectUri);
        if (req.method !== 'GET' || reqUrl.pathname !== REDIRECT_PATH) {
          res.writeHead(404).end();
          return;
        }
        const say = i18n.t;
        const reply = (status, message) => {
          // Connection: close, så serveren kan lukke helt, når login er færdigt.
          res.writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'close',
          });
          res.end(callbackPage(message));
        };
        const params = reqUrl.searchParams;
        if (params.get('state') !== state) {
          reply(400, say('callback.state'));
          return;
        }
        if (params.get('error')) {
          reply(200, say('callback.cancelled'));
          finish(new SpotifyError('LOGIN_CANCELLED', `Spotify-login blev afbrudt (${params.get('error')}).`, { detail: params.get('error') }));
          return;
        }
        const code = params.get('code');
        if (!code) {
          reply(400, say('callback.noCode'));
          return;
        }
        try {
          const tokens = await this.exchangeCode({ clientId, code, verifier });
          reply(200, say('callback.ok'));
          finish(null, tokens);
        } catch (err) {
          reply(500, say('callback.failed', { detail: err.message }));
          finish(err);
        }
      });

      timer = setTimeout(() => finish(new SpotifyError('LOGIN_TIMEOUT', 'Login took too long. Try again.')), LOGIN_TIMEOUT_MS);
      if (timer.unref) timer.unref();

      server.on('error', (err) => {
        finish(
          err.code === 'EADDRINUSE'
            ? new SpotifyError('PORT_IN_USE', `Port ${this.port} is used by another program. Close it and try again.`, { detail: this.port })
            : err
        );
      });
      server.listen(this.port, REDIRECT_HOST, () => {
        Promise.resolve()
          .then(() => this.openExternal(authorizeUrl))
          .catch((err) => finish(err));
      });
    });

    this.pendingLogin = { url: authorizeUrl, promise };
    return promise;
  }

  async exchangeCode({ clientId, code, verifier }) {
    const data = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      })
    );
    const tokens = toTokenRecord(data, null);
    this.tokenStore.save(tokens);
    return tokens;
  }

  async tokenRequest(body) {
    let res;
    try {
      res = await this.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new SpotifyError('NETWORK', `Could not reach Spotify: ${err.message}`, { detail: err.message });
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      if (data.error === 'invalid_grant') {
        throw new SpotifyError('NOT_LOGGED_IN', 'The Spotify login has expired or was revoked. Log in again.', { status: res.status });
      }
      if (data.error === 'invalid_client') {
        throw new SpotifyError('INVALID_CLIENT', 'Spotify does not recognize this Client ID. Check it under Settings.', { status: res.status });
      }
      const detail = data.error_description || data.error || `HTTP ${res.status}`;
      throw new SpotifyError('AUTH_FAILED', `Spotify-login fejlede: ${detail}`, { status: res.status, detail });
    }
    return data;
  }

  /** Giver et gyldigt access token og fornyer det automatisk, når det er udløbet. */
  async getAccessToken({ forceRefresh = false } = {}) {
    const tokens = this.tokenStore.load();
    if (!tokens || !tokens.refreshToken) {
      throw new SpotifyError('NOT_LOGGED_IN', 'Log in with Spotify under Settings.');
    }
    if (!forceRefresh && tokens.accessToken && tokens.expiresAt > Date.now()) {
      return tokens.accessToken;
    }
    if (!this.refreshing) {
      // .finally kører altid asynkront, så feltet nulstilles først efter tildelingen.
      this.refreshing = this.refresh(tokens).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async refresh(tokens) {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new SpotifyError('NOT_CONFIGURED', 'Enter a Spotify Client ID under Settings first.');
    }
    try {
      const data = await this.tokenRequest(
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: clientId })
      );
      const next = toTokenRecord(data, tokens);
      this.tokenStore.save(next);
      return next.accessToken;
    } catch (err) {
      if (err.code === 'NOT_LOGGED_IN' || err.code === 'INVALID_CLIENT') this.tokenStore.clear();
      throw err;
    }
  }

  logout() {
    this.tokenStore.clear();
  }

  /**
   * Spørger Spotify, om et Client ID findes, uden at logge ind: en bevidst ugyldig login-kode giver
   * "invalid_grant" for et rigtigt ID og "invalid_client" for et ukendt (fx et indsat Client Secret).
   */
  async checkClientId(clientId) {
    try {
      await this.tokenRequest(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'the-grid-client-id-check',
          redirect_uri: this.redirectUri,
          client_id: clientId,
          code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        })
      );
      return { valid: true };
    } catch (err) {
      if (err.code === 'NOT_LOGGED_IN') return { valid: true }; // invalid_grant: ID'et findes
      if (err.code === 'INVALID_CLIENT') return { valid: false };
      throw err;
    }
  }
}

function toTokenRecord(data, previous) {
  return {
    accessToken: data.access_token,
    // Ved PKCE roterer Spotify refresh-tokenet; behold det gamle, hvis der ikke kom et nyt.
    refreshToken: data.refresh_token || (previous && previous.refreshToken) || null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - EXPIRY_SKEW_MS,
    scope: data.scope || (previous && previous.scope) || '',
  };
}

module.exports = { SpotifyAuth, SCOPES, DEFAULT_PORT, redirectUriFor, toTokenRecord, escapeHtml };
