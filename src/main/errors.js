'use strict';

/**
 * Fejl med en maskinlæsbar kode, så rendereren kan reagere på den og vise en oversat tekst
 * (nøglen `err.<code>` i src/shared/i18n.js). `detail` indsættes i teksten, fx en HTTP-status.
 * `message` er den danske reserve, hvis en oversættelse mangler.
 */
class SpotifyError extends Error {
  constructor(code, message, { status, detail } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

module.exports = { SpotifyError };
