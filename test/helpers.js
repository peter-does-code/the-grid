'use strict';

/** Minimal Response-attrap, der opfører sig som fetch-svaret på de punkter, koden bruger. */
function response(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() in lower ? String(lower[name.toLowerCase()]) : null) },
    text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/**
 * Falsk fetch med ruter som "GET /v1/playlists/ID". En rute kan være et svar, en funktion
 * eller en liste af svar, der bruges i rækkefølge (det sidste gentages).
 */
function fakeFetch(routes) {
  const calls = [];
  const counters = {};
  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    const parsed = new URL(url);
    const key = `${method} ${parsed.pathname}`;
    calls.push({ key, url: parsed, init, body: init.body ? tryJson(init.body) : undefined });
    const route = routes[key];
    if (route === undefined) return response(404, { error: { status: 404, message: `Ingen rute: ${key}` } });
    if (typeof route === 'function') return route(parsed, init, calls);
    if (Array.isArray(route)) {
      const i = Math.min(counters[key] || 0, route.length - 1);
      counters[key] = (counters[key] || 0) + 1;
      const entry = route[i];
      return typeof entry === 'function' ? entry(parsed, init, calls) : entry;
    }
    return route;
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function memoryTokenStore(initial = null) {
  return {
    value: initial,
    saves: 0,
    load() {
      return this.value;
    },
    save(tokens) {
      this.value = tokens;
      this.saves += 1;
    },
    clear() {
      this.value = null;
    },
  };
}

function rawTrack(id, extra = {}) {
  return {
    type: 'track',
    id,
    uri: `spotify:track:${id}`,
    name: `Nummer ${id}`,
    artists: [{ name: 'Kunstner' }],
    album: { name: 'Album', uri: 'spotify:album:alb' },
    duration_ms: 200000,
    is_local: false,
    ...extra,
  };
}

module.exports = { response, fakeFetch, memoryTokenStore, rawTrack };
