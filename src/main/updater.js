'use strict';

/*
 * Automatiske opdateringer fra GitHub Releases (electron-updater). Kun i den installerede app, ikke under
 * `npm start` eller testene.
 *
 * Appen tjekker 10 s efter start og derefter hver 4. time, henter en ny udgave i baggrunden og installerer
 * den, når The Grid lukkes. Rendereren får besked (`update:status`), så den kan vise en kort tekst, og kan
 * bede om at installere med det samme (`update:installNow`).
 *
 * Hvor der hentes fra, står i package.json under build.publish (electron-builder lægger det i
 * resources/app-update.yml). Er releases-repoet privat, lægger scripts/release.js en læse-token i
 * resources/update-token.txt; den giver kun adgang til at hente filer fra det ene repo.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain } = require('electron');

const FIRST_CHECK_MS = 10 * 1000;
const CHECK_EVERY_MS = 4 * 3600 * 1000;

function readToken() {
  try {
    return fs.readFileSync(path.join(process.resourcesPath, 'update-token.txt'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function startUpdater({ log = console, send, publish }) {
  if (!app.isPackaged) {
    // Under udvikling: ingen opdateringer, men rendereren får stadig svar.
    ipcMain.handle('update:status', () => ({ state: 'idle' }));
    ipcMain.handle('update:installNow', () => false);
    return null;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log.error('The updater could not be loaded:', err);
    return null;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  const token = readToken();
  if (token && publish) autoUpdater.setFeedURL({ ...publish, private: true, token });

  let status = { state: 'idle' };
  const set = (next) => {
    status = next;
    send('update:status', status);
  };
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  // Ingen forbindelse eller GitHub nede: prøv igen ved næste tjek, uden at forstyrre.
  autoUpdater.on('error', (err) => log.warn('Update check failed:', (err && err.message) || err));

  const check = () => autoUpdater.checkForUpdates().catch((err) => log.warn('Update check failed:', (err && err.message) || err));
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);

  ipcMain.handle('update:status', () => status);
  ipcMain.handle('update:installNow', () => {
    if (status.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return status.state === 'ready';
  });
  return autoUpdater;
}

module.exports = { startUpdater, readToken };
