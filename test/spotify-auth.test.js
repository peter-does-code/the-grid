'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SpotifyAuth, SCOPES } = require('../src/main/spotify-auth.js');
const { codeChallengeS256 } = require('../src/main/pkce.js');
const { response, fakeFetch, memoryTokenStore } = require('./helpers.js');

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const TEST_PORT = 43199;

function tokenRoute(handler) {
  return fakeFetch({
    'POST /api/token': (_url, init) => handler(new URLSearchParams(init.body)),
  });
}

test('et gyldigt access token genbruges uden netværkskald', async () => {
  const store = memoryTokenStore({ accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 60000 });
  const fetchImpl = tokenRoute(() => response(500, {}));
  const auth = new SpotifyAuth({ getClientId: () => CLIENT_ID, tokenStore: store, openExternal: () => {}, fetchImpl });
  assert.equal(await auth.getAccessToken(), 'A');
  assert.equal(fetchImpl.calls.length, 0);
});

test('udløbet token fornyes én gang, også ved samtidige kald, og det nye refresh-token gemmes', async () => {
  const store = memoryTokenStore({ accessToken: 'gammel', refreshToken: 'R1', expiresAt: Date.now() - 1 });
  const fetchImpl = tokenRoute((params) => {
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('refresh_token'), 'R1');
    assert.equal(params.get('client_id'), CLIENT_ID);
    return response(200, { access_token: 'ny', refresh_token: 'R2', expires_in: 3600, scope: 'x' });
  });
  const auth = new SpotifyAuth({ getClientId: () => CLIENT_ID, tokenStore: store, openExternal: () => {}, fetchImpl });
  const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
  assert.equal(a, 'ny');
  assert.equal(b, 'ny');
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(store.value.refreshToken, 'R2');
  assert.ok(store.value.expiresAt > Date.now());
});

test('refresh-token uden rotation beholder det gamle', async () => {
  const store = memoryTokenStore({ accessToken: 'gammel', refreshToken: 'R1', expiresAt: 0 });
  const fetchImpl = tokenRoute(() => response(200, { access_token: 'ny', expires_in: 3600 }));
  const auth = new SpotifyAuth({ getClientId: () => CLIENT_ID, tokenStore: store, openExternal: () => {}, fetchImpl });
  await auth.getAccessToken();
  assert.equal(store.value.refreshToken, 'R1');
});

test('invalid_grant logger ud og giver NOT_LOGGED_IN', async () => {
  const store = memoryTokenStore({ accessToken: 'gammel', refreshToken: 'R1', expiresAt: 0 });
  const fetchImpl = tokenRoute(() => response(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }));
  const auth = new SpotifyAuth({ getClientId: () => CLIENT_ID, tokenStore: store, openExternal: () => {}, fetchImpl });
  await assert.rejects(auth.getAccessToken(), { code: 'NOT_LOGGED_IN' });
  assert.equal(store.value, null);
  assert.equal(auth.isLoggedIn(), false);
});

test('en fejl før første netværkskald låser ikke fornyelsen fast', async () => {
  let clientId = '';
  const store = memoryTokenStore({ accessToken: 'gammel', refreshToken: 'R1', expiresAt: 0 });
  const fetchImpl = tokenRoute(() => response(200, { access_token: 'ny', expires_in: 3600 }));
  const auth = new SpotifyAuth({ getClientId: () => clientId, tokenStore: store, openExternal: () => {}, fetchImpl });
  await assert.rejects(auth.getAccessToken(), { code: 'NOT_CONFIGURED' });
  clientId = CLIENT_ID;
  assert.equal(await auth.getAccessToken(), 'ny');
});

test('login uden Client ID afvises med det samme', async () => {
  const auth = new SpotifyAuth({ getClientId: () => '', tokenStore: memoryTokenStore(), openExternal: () => {} });
  await assert.rejects(auth.login(), { code: 'NOT_CONFIGURED' });
});

test('hele PKCE-login-flowet via loopback-serveren', async () => {
  const store = memoryTokenStore();
  let authorizeUrl = null;
  const fetchImpl = tokenRoute((params) => {
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'kode123');
    assert.equal(params.get('client_id'), CLIENT_ID);
    assert.equal(params.get('redirect_uri'), `http://127.0.0.1:${TEST_PORT}/callback`);
    // Verifikatoren skal passe til den challenge, der blev sendt i authorize-URL'en.
    assert.equal(codeChallengeS256(params.get('code_verifier')), authorizeUrl.searchParams.get('code_challenge'));
    return response(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: SCOPES.join(' ') });
  });

  const auth = new SpotifyAuth({
    getClientId: () => CLIENT_ID,
    tokenStore: store,
    fetchImpl,
    port: TEST_PORT,
    openExternal: async (url) => {
      authorizeUrl = new URL(url);
      assert.equal(authorizeUrl.origin + authorizeUrl.pathname, 'https://accounts.spotify.com/authorize');
      assert.equal(authorizeUrl.searchParams.get('response_type'), 'code');
      assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authorizeUrl.searchParams.get('client_id'), CLIENT_ID);
      const state = authorizeUrl.searchParams.get('state');
      const base = `http://127.0.0.1:${TEST_PORT}/callback`;

      // Et svar med forkert state afvises, men login fortsætter med at vente.
      const wrong = await fetch(`${base}?code=forkert&state=forkert`);
      assert.equal(wrong.status, 400);
      await wrong.text();

      // Browseren vender tilbage med den rigtige kode.
      const ok = await fetch(`${base}?code=kode123&state=${encodeURIComponent(state)}`);
      assert.equal(ok.status, 200);
      assert.match(await ok.text(), /logged in/);
    },
  });

  const tokens = await auth.login();
  assert.equal(tokens.accessToken, 'A');
  assert.equal(store.value.refreshToken, 'R');
  assert.equal(auth.isLoggedIn(), true);
  assert.equal(fetchImpl.calls.length, 1);
});

test('login der afbrydes i browseren giver LOGIN_CANCELLED', async () => {
  const auth = new SpotifyAuth({
    getClientId: () => CLIENT_ID,
    tokenStore: memoryTokenStore(),
    fetchImpl: tokenRoute(() => response(500, {})),
    port: TEST_PORT,
    openExternal: async (url) => {
      const state = new URL(url).searchParams.get('state');
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/callback?error=access_denied&state=${encodeURIComponent(state)}`);
      await res.text();
    },
  });
  await assert.rejects(auth.login(), { code: 'LOGIN_CANCELLED' });
});
