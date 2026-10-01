'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSpotifyInput, isShortLink, findSpotifyLinkInText } = require('../src/main/spotify-parse.js');

const ID = '37i9dQZF1DXcBWIGoYBM5M';

test('forstår de almindelige linkformer', () => {
  const cases = [
    [`https://open.spotify.com/playlist/${ID}?si=abc123`, 'playlist'],
    [`https://open.spotify.com/intl-da/playlist/${ID}`, 'playlist'],
    [`https://open.spotify.com/embed/album/${ID}`, 'album'],
    [`https://open.spotify.com/user/nogen/playlist/${ID}`, 'playlist'],
    [`open.spotify.com/track/${ID}`, 'track'],
    [`spotify:playlist:${ID}`, 'playlist'],
    [`spotify:user:nogen:playlist:${ID}`, 'playlist'],
    [`spotify:album:${ID}`, 'album'],
    [ID, 'playlist'],
    [`   https://open.spotify.com/playlist/${ID}   `, 'playlist'],
  ];
  for (const [input, type] of cases) {
    assert.deepEqual(parseSpotifyInput(input), { type, id: ID }, input);
  }
});

test('afviser alt andet', () => {
  for (const input of [
    `https://example.com/playlist/${ID}`,
    `spotify:artist:${ID}`,
    `https://open.spotify.com/artist/${ID}`,
    'https://open.spotify.com/playlist/forkort',
    'hej',
    '',
    null,
    undefined,
  ]) {
    assert.equal(parseSpotifyInput(input), null, String(input));
  }
});

test('genkender korte delingslinks fra mobilappen', () => {
  assert.equal(isShortLink('https://spotify.link/AbCdEf'), true);
  assert.equal(isShortLink(`https://open.spotify.com/playlist/${ID}`), false);
  assert.equal(isShortLink('ikke en url'), false);
});

test('finder et open.spotify.com-link i HTML', () => {
  const html = `<html><a href="https://open.spotify.com/intl-da/playlist/${ID}?si=x">Åbn</a></html>`;
  assert.deepEqual(findSpotifyLinkInText(html), { type: 'playlist', id: ID });
  assert.equal(findSpotifyLinkInText('intet her'), null);
});
