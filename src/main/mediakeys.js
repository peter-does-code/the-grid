'use strict';

const { runScript } = require('./powershell');

// Virtuelle tastkoder for Windows' medietaster.
const VK = {
  playpause: 0xb3,
  stop: 0xb2,
  previous: 0xb1,
  next: 0xb0,
};

/**
 * Sender en medietast til Windows, præcis som tasterne på et multimedie-tastatur.
 * Spotify-appen (og de fleste andre afspillere) reagerer på dem, også uden Premium.
 * Selve tastetrykket ligger i src/main/ps/mediakey.ps1.
 * @param {'playpause'|'stop'|'previous'|'next'} name
 */
async function sendMediaKey(name, { run = runScript } = {}) {
  const vk = VK[name];
  if (vk === undefined) throw new Error(`Unknown media key: ${name}`);
  if (process.platform !== 'win32') throw new Error('Media keys are only supported on Windows.');
  await run('mediakey.ps1', ['-Vk', vk]);
}

module.exports = { sendMediaKey, VK };
