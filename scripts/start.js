'use strict';

// Starter Electron med et rent miljø. VS Code og andre Electron-baserede værktøjer sætter
// ELECTRON_RUN_AS_NODE=1 for deres underprocesser, og så starter Electron som ren Node uden vindue.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});
child.on('close', (code) => process.exit(code === null ? 1 : code));
