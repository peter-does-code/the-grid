'use strict';

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const PS_DIR = path.join(__dirname, 'ps');

/**
 * Stien til et script i src/main/ps. I den pakkede app ligger kildekoden i app.asar, som PowerShell
 * ikke kan læse; scripts pakkes derfor ud ved siden af (asarUnpack i package.json).
 */
function scriptPath(name, dir = PS_DIR) {
  return path.join(dir, name).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/**
 * Argumenter til powershell.exe. Scripts køres som filer med -File frem for -EncodedCommand, som
 * antivirusprogrammer ofte slår alarm over. -ExecutionPolicy Bypass gælder kun denne ene proces.
 */
function scriptArgs(name, args = []) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(name), ...args.map(String)];
}

/** Kører et script til ende. */
function runScript(name, args = [], { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', scriptArgs(name, args), { windowsHide: true, timeout }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });
}

/** Starter et script, der bliver ved med at køre (fx enhedsovervågningen). */
function spawnScript(name, args = [], { spawnImpl = spawn } = {}) {
  return spawnImpl('powershell.exe', scriptArgs(name, args), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

module.exports = { scriptPath, scriptArgs, runScript, spawnScript, PS_DIR };
