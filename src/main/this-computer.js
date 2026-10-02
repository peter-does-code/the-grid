'use strict';

/*
 * Spiller Spotify på denne pc? Spotify-appen kalder pc'en ved computernavnet, men ikke altid på samme
 * måde som os.hostname(): det kan være Windows' COMPUTERNAME, og navnet kan mangle eller have et domæne
 * bagved ("DESKTOP-ABC" mod "desktop-abc.lan"). Svaret afgør stilhedstærsklen (-70 dB mod -42 dB), så
 * et forkert nej giver et sort billede ved stille musik. Ingen Electron her, så det kan testes i Node.
 */
const os = require('node:os');

function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

/** Navnene, denne pc kan have: os.hostname() og Windows' COMPUTERNAME (ofte ens). */
function localComputerNames(env = process.env) {
  return { hostname: os.hostname(), computerName: env.COMPUTERNAME || null };
}

/** Ens (uden forskel på store og små bogstaver), eller det ene navn er starten af det andet op til et punktum eller en bindestreg. */
function namesMatch(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  const next = long[short.length];
  return long.startsWith(short) && (next === '.' || next === '-');
}

/** true, hvis Spotify-enhedens navn passer på pc'ens hostname eller COMPUTERNAME. */
function isThisComputer(deviceName, names = localComputerNames()) {
  return namesMatch(deviceName, names.hostname) || namesMatch(deviceName, names.computerName);
}

module.exports = { isThisComputer, namesMatch, localComputerNames };
