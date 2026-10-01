'use strict';

const crypto = require('node:crypto');

/** Kodeverifikator til OAuth PKCE (RFC 7636): 43-128 tegn fra det URL-sikre alfabet. */
function generateCodeVerifier(bytes = 64) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function codeChallengeS256(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('base64url');
}

module.exports = { generateCodeVerifier, codeChallengeS256, generateState };
