'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runScript } = require('./powershell');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** En kort stereo-WAV med bas-slag, toner og hi-hat, så både bas, mellemtone og diskant giver udslag. */
const QUIET = process.argv.includes('--quiet');

function writeTestWav(file, { seconds = 3, sampleRate = 44100, gain = 0.35 } = {}) {
  const frames = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(frames * 4);
  let seed = 1;
  const noise = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * (55 + 110 * Math.exp(-beat * 35)) * beat) * Math.exp(-beat * 9);
    const note = 220 * Math.pow(2, (Math.floor(t * 4) % 8) / 12);
    const tone = Math.sin(2 * Math.PI * note * t) * 0.4;
    const hat = noise() * Math.exp(-(t % 0.25) * 70) * 0.3;
    const sample = Math.max(-1, Math.min(1, (kick + tone + hat) * gain));
    const value = Math.round(sample * 32767);
    data.writeInt16LE(value, i * 4);
    data.writeInt16LE(value, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

function playWav(file) {
  return runScript('play-wav.ps1', ['-Path', file], { timeout: 20000 });
}

function waitForShown(ipcMain, view, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const onShown = (_event, shownView) => {
      if (shownView !== view) return;
      clearTimeout(timer);
      ipcMain.removeListener('selftest:shown', onShown);
      resolve(true);
    };
    const timer = setTimeout(() => {
      ipcMain.removeListener('selftest:shown', onShown);
      resolve(false);
    }, timeoutMs);
    ipcMain.on('selftest:shown', onShown);
  });
}

function waitUntilLoaded(win) {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
}

async function savePng(win, file) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
}

/**
 * Starter appen, afspiller en testlyd gennem Windows, måler hvad visualizeren modtog,
 * tager skærmbilleder af vinduet og skriver en rapport. Bruges af `npm run selftest`.
 */
/**
 * Visningerne, der fotograferes. Den hurtige selvtest (standard, ca. 20 s) tjekker det vigtigste:
 * dialogerne, introens start, fuld skærm, Clu-temaet og at Init kan høres. Den fulde (--selftest-full,
 * ca. 90 s) venter også introens faser, Game Grid-vinderen og alle påskeæg igennem i realtid.
 */
const QUICK_VIEWS = ['settings', 'presets', 'help', 'terminal', 'guide', 'welcome', 'intro', 'fullscreen', 'drew-audio', 'clu'];
const FULL_VIEWS = ['settings', 'presets', 'help', 'terminal', 'guide', 'welcome', 'intro', 'intro-battle', 'intro-duel', 'intro-text', 'intro-classic', 'battle-win', 'tron-overlay', 'battle-epic', 'fullscreen', 'egg-users', 'egg-greetings', 'egg-encom', 'egg-zen', 'egg-rinzler', 'egg-spaces', 'egg-jazz', 'egg-clu', 'drew', 'drew-pound', 'drew-audio', 'terminal-return', 'clu'];

async function runSelftest({ win, ipcMain, outDir, full = false }) {
  const startedAt = Date.now();
  fs.mkdirSync(outDir, { recursive: true });
  const consoleLines = [];
  win.webContents.on('console-message', (event) => {
    consoleLines.push(`[${event.level}] ${event.message}`);
  });
  const reportPromise = new Promise((resolve) => {
    ipcMain.handleOnce('selftest:report', (_event, data) => {
      resolve(data);
      return true;
    });
  });

  await waitUntilLoaded(win);
  await sleep(3500); // lad lydfangst og første preset komme i gang

  const wav = path.join(outDir, 'selftest-tone.wav');
  // --quiet: testlyden og Init næsten uhørligt (Peter 01-10-2026: testene spillede for højt). Lydfangst og
  // automatisk lydniveau virker stadig; kun lydstyrken i højttalerne er lav.
  writeTestWav(wav, { gain: QUIET ? 0.02 : 0.35 });
  win.webContents.send('selftest:phase', 'audio-start');
  const playing = playWav(wav).catch((err) => consoleLines.push(`[main] Could not play the test sound: ${err.message}`));
  await sleep(1800);
  await savePng(win, path.join(outDir, 'screenshot-during-audio.png'));
  await playing;
  win.webContents.send('selftest:phase', 'audio-end');
  await sleep(500);

  win.webContents.send('selftest:collect');
  const report = await Promise.race([
    reportPromise,
    sleep(8000).then(() => ({ error: 'The renderer sent no report within 8 seconds.' })),
  ]);
  await savePng(win, path.join(outDir, 'screenshot-final.png'));

  // Skærmbilleder af dialogerne og velkomstvisningen, så layoutet kan tjekkes.
  // Rendereren bekræfter først, når visningen er tegnet, så billedet aldrig viser det forrige trin.
  // "intro" er midt i lyscykel-kampen, "intro-text" når "WELCOME TO THE GRID" er skrevet færdig.
  for (const view of full ? FULL_VIEWS : QUICK_VIEWS) {
    const timeoutMs = /^(intro|egg-|terminal-return|battle|drew|tron)/.test(view) ? 30000 : 3000;
    const shown = waitForShown(ipcMain, view, timeoutMs);
    win.webContents.send('selftest:show', view);
    if (!(await shown)) consoleLines.push(`[main] The renderer did not confirm the view "${view}" within ${timeoutMs / 1000} seconds.`);
    await sleep(300);
    await savePng(win, path.join(outDir, `screenshot-${view}.png`));
  }

  // Musikken i påskeægget "drew" skal kunne høres: lydstyrken skal være skruet op efter fire sekunder.
  // (Fanger fejlen fra 30-09-2026, hvor fade-in'en gik i stå, og sangen spillede på lydstyrke 0.)
  const audioLine = consoleLines.filter((line) => line.includes('drew-audio 4000')).pop();
  let music = { ok: false, detail: 'ingen måling' };
  if (audioLine) {
    try {
      const state = JSON.parse(audioLine.slice(audioLine.indexOf('{')));
      music = { ok: !state.paused && state.volume > (QUIET ? 0.003 : 0.1) && state.currentTime > 2 && state.error === null, ...state };
    } catch (err) {
      music = { ok: false, detail: String(err) };
    }
  }
  if (report && typeof report === 'object') {
    report.music = { ...(report.music || {}), initPlayback: music };
    if (!music.ok) report.ok = false;
  }
  const result = { createdAt: new Date().toISOString(), mode: full ? 'full' : 'quick', seconds: Math.round((Date.now() - startedAt) / 1000), report, console: consoleLines };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(result, null, 2));
  return result;
}

module.exports = { runSelftest, writeTestWav };
