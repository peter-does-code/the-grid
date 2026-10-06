'use strict';

/*
 * Bygger The Grid og installerer den på denne pc, uden at udgive noget (Peters arbejdsgang fra 05-10-2026: hver
 * ændring installeres lokalt; først når Peter siger det, udgives den til alle med npm run release).
 *
 *   npm run install:local            byg og installér (The Grid skal være lukket)
 *   npm run install:local -- --wait  vent, til The Grid er lukket, og installér så
 *
 * - Versionen bliver den næste patch med "-local" (0.1.21 → 0.1.22-local), så den næste rigtige udgivelse (0.1.22)
 *   stadig er nyere, og appen opdaterer sig til den. package.json sættes tilbage bagefter, også ved fejl.
 * - Læse-tokenen (%USERPROFILE%\.the-grid\update-token.txt) kopieres ind til bygget og fjernes igen, så den
 *   installerede app kan opdatere sig selv.
 * - Kør den som en selvstændig proces (fx PowerShell Start-Process), ikke inde i en kommando med tidsgrænse:
 *   afbrydes den midt i, står package.json på "-local" (sket 05-10-2026). Så retter næste kørsel det selv.
 * - Til sidst: "INSTALLED" og git status skal være ren.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkgFile = path.join(root, 'package.json');
const tokenSource = path.join(os.homedir(), '.the-grid', 'update-token.txt');
const tokenTarget = path.join(root, 'build', 'update-token', 'update-token.txt');
const shell = process.platform === 'win32';

const running = () => {
  try {
    return execFileSync('tasklist', ['/FI', 'IMAGENAME eq The Grid.exe'], { encoding: 'utf8' }).includes('The Grid.exe');
  } catch {
    return false;
  }
};

(async () => {
  if (running()) {
    if (!process.argv.includes('--wait')) {
      console.error('The Grid is running. Close it first, or use --wait.');
      process.exit(1);
    }
    console.log('Waiting for The Grid to close ...');
    while (running()) await new Promise((r) => setTimeout(r, 5000));
  }

  let original = fs.readFileSync(pkgFile, 'utf8');
  let pkg = JSON.parse(original);
  // En afbrudt kørsel kan have efterladt "-local": tag versionen fra git (kun det felt).
  if (/-local$/.test(pkg.version)) {
    pkg.version = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: root, encoding: 'utf8' })).version;
    original = `${JSON.stringify(pkg, null, 2)}\n`;
    console.log('Reset a leftover local version.');
  }
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const version = `${major}.${minor}.${patch + 1}-local`;
  try {
    fs.writeFileSync(pkgFile, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
    if (fs.existsSync(tokenSource)) {
      fs.mkdirSync(path.dirname(tokenTarget), { recursive: true });
      fs.copyFileSync(tokenSource, tokenTarget);
    } else console.warn(`No update token at ${tokenSource}: the installed app will not update itself.`);
    execFileSync('node', ['scripts/prepare-build.js'], { cwd: root, stdio: 'inherit', shell });
    execFileSync('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never'], { cwd: root, stdio: 'inherit', shell });
    const installer = path.join(root, 'dist', `The-Grid-Setup-${version}.exe`);
    const res = spawnSync(installer, ['/S'], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error(`installer exited with ${res.status}`);
    console.log(`INSTALLED ${version}`);
  } finally {
    fs.rmSync(tokenTarget, { force: true });
    fs.writeFileSync(pkgFile, original);
    // Kun den nye lokale installationsfil bliver liggende.
    for (const name of fs.readdirSync(path.join(root, 'dist'))) {
      if (/^The-Grid-Setup-.*-local\.exe(\.blockmap)?$/.test(name) && !name.includes(version)) fs.rmSync(path.join(root, 'dist', name), { force: true });
    }
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
