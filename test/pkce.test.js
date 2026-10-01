'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { codeChallengeS256, generateCodeVerifier, generateState } = require('../src/main/pkce.js');

test('code challenge matcher testvektoren i RFC 7636, appendiks B', () => {
  assert.equal(
    codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  );
});

test('code verifier har gyldig længde og tegnsæt og er tilfældig', () => {
  const verifier = generateCodeVerifier();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `længde ${verifier.length}`);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, generateCodeVerifier());
  assert.notEqual(generateState(), generateState());
});
