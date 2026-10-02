'use strict';

/*
 * Udgiver en ny version af The Grid (Drews app opdaterer sig selv ud fra den):
 *
 *   npm run release            0.1.0 → 0.1.1
 *   npm run release -- minor   0.1.0 → 0.2.0
 *
 * 1. Kører testene; fejler én, stopper udgivelsen.
 * 2. Hæver versionen i package.json.
 * 3. Bygger installationsfilen med en læse-token til det private releases-repo (se nedenfor), skriver
 *    latest.yml og lægger de tre filer op som en GitHub-release med gh.
 * 4. Er projektet et git-repo: commit og tag vX.Y.Z, og push.
 *
 * Kræver:
 *   - gh logget ind som ejeren af releases-repoet (build.publish.owner i package.json). Tokenen herfra
 *     bruges kun til at lægge filerne op og kommer ikke med i appen.
 *   - Læse-tokenen, som appen henter opdateringer med, i %USERPROFILE%\.the-grid\update-token.txt: en
 *     fine-grained token med adgang til kun releases-repoet og kun "Contents: Read-only". Den kommer med i
 *     installationsfilen, så den må ikke kunne andet. Den ligger uden for projektet, så den aldrig havner i git.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeLatestYml } = require('./lib/update-info');
const { writePeterPicks } = require('./lib/peter-picks');

const root = path.join(__dirname, '..');
const pkgFile = path.join(root, 'package.json');
const tokenSource = path.join(os.homedir(), '.the-grid', 'update-token.txt');
const tokenTarget = path.join(root, 'build', 'update-token', 'update-token.txt');
const bump = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'patch';
const shell = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell, ...opts });
}

function output(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', shell }).trim();
}

function nextVersion(version, kind) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown version bump "${kind}" (use patch, minor or major).`);
}

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const { owner, repo } = pkg.build.publish;

if (!fs.existsSync(tokenSource)) {
  console.error(`Missing the app's read-only update token: ${tokenSource}\nSee docs/releasing.md.`);
  process.exit(1);
}
let publishToken;
try {
  publishToken = output('gh', ['auth', 'token', '--user', owner]);
} catch {
  console.error(`gh is not logged in as ${owner}. Run: gh auth login (and log in as ${owner}).`);
  process.exit(1);
}

// Kun fra en ren arbejdsmappe: ellers kommer halvfærdige ændringer med i release-committen, og bygget kan fange
// filer midt i en ændring (sket med v0.1.6, 01-10-2026, hvor release-committen fik × i preset-listen med).
if (fs.existsSync(path.join(root, '.git')) && output('git', ['status', '--porcelain'])) {
  console.error('Uncommitted changes. Commit (or stash) them first, so the release only contains finished work.');
  process.exit(1);
}

run('npm', ['test']);

const version = nextVersion(pkg.version, bump);
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\nReleasing The Grid v${version} to ${owner}/${repo}\n`);
// Peters seneste favoritter og derez med i bygget ("Use Peter's picks"); committes sammen med versionen.
const picks = writePeterPicks();
console.log(`Peter's picks: ${picks.favorites} favourites, ${picks.derez} derez.`);

fs.mkdirSync(path.dirname(tokenTarget), { recursive: true });
fs.copyFileSync(tokenSource, tokenTarget);
try {
  run('node', ['scripts/prepare-build.js']);
  run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never']);
} finally {
  fs.rmSync(tokenTarget, { force: true });
}

// Kan den byggede app opdatere sig selv? (v0.1.1-v0.1.10 manglede modulet semver i bygget, så electron-updater
// aldrig startede, og ingen installeret app fandt en ny udgave; opdaget 02-10-2026.) Ét tjek mod GitHub, før der
// udgives noget.
{
  const exe = path.join(root, 'dist', 'win-unpacked', 'The Grid.exe');
  const checkFile = path.join(os.tmpdir(), `the-grid-update-check-${process.pid}.json`);
  execFileSync(exe, [`--update-check=${checkFile}`], { cwd: root, timeout: 60000 });
  const check = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
  fs.rmSync(checkFile, { force: true });
  if (!check.updaterLoaded || check.error || !check.token || !check.latest) {
    console.error('The built app cannot check for updates; nothing was released:\n' + JSON.stringify(check, null, 2));
    process.exit(1);
  }
  console.log(`Update check from the built app works (latest on GitHub: ${check.latest}).`);
}

// Releasen laves med gh i ét hug. electron-builders egen upload sender filerne samtidig, og hver prøver at
// oprette releasen; det gav "422 Published releases must have a valid tag" og en release uden latest.yml
// (v0.1.1, 01-10-2026). latest.yml skrives her, så den altid passer til installationsfilen.
const installer = path.join(root, 'dist', `The-Grid-Setup-${version}.exe`);
const latest = writeLatestYml(installer, version);
run(
  'gh',
  ['release', 'create', `v${version}`, installer, `${installer}.blockmap`, latest, '-R', `${owner}/${repo}`, '--title', version, '--notes', `The Grid ${version}`],
  // Uden shell: gh.exe er et almindeligt program, og noter med mellemrum må ikke deles op.
  { shell: false, env: { ...process.env, GH_TOKEN: publishToken } }
);

if (fs.existsSync(path.join(root, '.git'))) {
  // Uden shell: git er et almindeligt program, og commit-beskeden har mellemrum (v0.1.2 fejlede her, 01-10-2026).
  const git = (args) => run('git', args, { shell: false });
  // Kun versionen og Peters valg; alt andet er committet før udgivelsen.
  git(['add', 'package.json', path.relative(root, picks.file)]);
  git(['commit', '-m', `Release v${version}`]);
  git(['tag', `v${version}`]);
  git(['push', 'origin', 'HEAD', `v${version}`]); // --follow-tags tager kun annoterede tags med
}
// Ryd op i dist: kun den nye installationsfil bliver liggende (de gamle ligger på GitHub; før fyldte de 1,6 GB).
for (const name of fs.readdirSync(path.join(root, 'dist'))) {
  if (/^The-Grid-Setup-.*\.exe(\.blockmap)?$/.test(name) && !name.startsWith(`The-Grid-Setup-${version}.`)) {
    fs.rmSync(path.join(root, 'dist', name), { force: true });
  }
}
console.log(`\nDone: v${version} is on https://github.com/${owner}/${repo}/releases. Drew's app installs it at its next start (or within 4 hours if it is running).`);
