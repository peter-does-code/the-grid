'use strict';

// Spotify-id'er er 22 tegn base62.
const ID_RE = /^[A-Za-z0-9]{22}$/;
const TYPES = ['playlist', 'album', 'track'];
const WEB_HOSTS = new Set(['open.spotify.com', 'play.spotify.com']);
const SHORT_HOSTS = new Set(['spotify.link', 'spoti.fi']);

/**
 * Forstår de former, et Spotify-link typisk har:
 *   https://open.spotify.com/playlist/ID?si=...
 *   https://open.spotify.com/intl-da/album/ID
 *   https://open.spotify.com/embed/playlist/ID
 *   https://open.spotify.com/user/NAVN/playlist/ID   (gammelt format)
 *   spotify:playlist:ID  og  spotify:user:NAVN:playlist:ID
 *   open.spotify.com/playlist/ID  (uden https://)
 *   ID alene (tolkes som playliste)
 * Returnerer { type, id } eller null.
 */
function parseSpotifyInput(raw) {
  if (typeof raw !== 'string') return null;
  const input = raw.trim();
  if (!input) return null;

  if (input.toLowerCase().startsWith('spotify:')) {
    const parts = input.split(':');
    for (let i = 1; i < parts.length - 1; i++) {
      const type = parts[i].toLowerCase();
      if (TYPES.includes(type) && ID_RE.test(parts[i + 1])) return { type, id: parts[i + 1] };
    }
    return null;
  }

  if (ID_RE.test(input)) return { type: 'playlist', id: input };

  let url;
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (!WEB_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    const type = segments[i].toLowerCase();
    if (TYPES.includes(type) && ID_RE.test(segments[i + 1])) return { type, id: segments[i + 1] };
  }
  return null;
}

/** Korte delingslinks fra Spotify-mobilappen, som skal følges før de kan tolkes. */
function isShortLink(raw) {
  try {
    const host = new URL(String(raw).trim()).hostname.toLowerCase();
    return SHORT_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Finder et open.spotify.com-link i en endelig URL eller en HTML-side. */
function findSpotifyLinkInText(text) {
  const match = /https:\/\/open\.spotify\.com\/(?:[a-z-]+\/)*(playlist|album|track)\/([A-Za-z0-9]{22})/.exec(String(text || ''));
  return match ? { type: match[1], id: match[2] } : null;
}

module.exports = { parseSpotifyInput, isShortLink, findSpotifyLinkInText, ID_RE };
