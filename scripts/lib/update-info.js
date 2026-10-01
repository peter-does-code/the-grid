'use strict';

/*
 * latest.yml til electron-updater: hvilken version der er den nyeste, og installationsfilens sha512 og
 * størrelse, så appen kan tjekke den hentede fil. Samme indhold, som electron-builder selv skriver.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function writeLatestYml(installer, version, releaseDate = new Date().toISOString()) {
  const name = path.basename(installer);
  const hash = sha512(installer);
  const size = fs.statSync(installer).size;
  const blockmap = `${installer}.blockmap`;
  const lines = [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${hash}`,
    `    size: ${size}`,
    ...(fs.existsSync(blockmap) ? [`    blockMapSize: ${fs.statSync(blockmap).size}`] : []),
    `path: ${name}`,
    `sha512: ${hash}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ];
  const out = path.join(path.dirname(installer), 'latest.yml');
  fs.writeFileSync(out, lines.join('\n'));
  return out;
}

module.exports = { writeLatestYml };
