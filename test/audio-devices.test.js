'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DefaultDeviceWatcher } = require('../src/main/audio-devices.js');
const { scriptArgs, scriptPath } = require('../src/main/powershell.js');
const { sendMediaKey } = require('../src/main/mediakeys.js');

test('første aflæsning og skift af standard-lydenhed meldes, gentagelser ignoreres', () => {
  const watcher = new DefaultDeviceWatcher();
  const seen = [];
  watcher.on('device', (device, info) => seen.push([device.name, info.changed]));
  watcher.handleLine('﻿{0.0.0.00000000}.{aaa}|Hovedtelefoner (HyperX Cloud Alpha Wireless)');
  watcher.handleLine('{0.0.0.00000000}.{aaa}|Hovedtelefoner (HyperX Cloud Alpha Wireless)');
  watcher.handleLine('|'); // midlertidig fejl under et skift
  watcher.handleLine('{0.0.0.00000000}.{bbb}|Højttalere (Realtek High Definition Audio)');
  assert.deepEqual(seen, [
    ['Hovedtelefoner (HyperX Cloud Alpha Wireless)', false],
    ['Højttalere (Realtek High Definition Audio)', true],
  ]);
  assert.equal(watcher.current.id, '{0.0.0.00000000}.{bbb}');
});

test('PowerShell-scripts køres som filer, ikke som -EncodedCommand', () => {
  const args = scriptArgs('mediakey.ps1', ['-Vk', 179]);
  assert.ok(!args.includes('-EncodedCommand'));
  assert.deepEqual(args.slice(-4), ['-File', scriptPath('mediakey.ps1'), '-Vk', '179']);
  // I den pakkede app ligger scripts uden for app.asar, som PowerShell ikke kan læse.
  assert.equal(
    scriptPath('mediakey.ps1', 'C:\\Programs\\The Grid\\resources\\app.asar\\src\\main\\ps'),
    'C:\\Programs\\The Grid\\resources\\app.asar.unpacked\\src\\main\\ps\\mediakey.ps1'
  );
});

test('scripts findes, er ASCII og bruger C#-klassen', () => {
  for (const name of ['audio-watch.ps1', 'mediakey.ps1', 'play-wav.ps1', 'audio-devices.cs']) {
    assert.ok(fs.existsSync(scriptPath(name)), name);
  }
  for (const name of ['audio-watch.ps1', 'mediakey.ps1', 'play-wav.ps1']) {
    // Windows PowerShell 5.1 læser scripts uden BOM i ANSI-tegnsættet.
    assert.match(fs.readFileSync(scriptPath(name), 'utf8'), /^[\x00-\x7f]*$/, `${name} er ikke ASCII`);
  }
  const watch = fs.readFileSync(scriptPath('audio-watch.ps1'), 'utf8');
  const cs = fs.readFileSync(scriptPath('audio-devices.cs'), 'utf8');
  assert.match(watch, /\[VisampAudio\.Audio\]::DefaultRender\(\)/);
  assert.match(cs, /namespace VisampAudio/);
});

test('medietaster sendes med den rigtige tastkode', { skip: process.platform !== 'win32' }, async () => {
  const calls = [];
  await sendMediaKey('playpause', { run: async (...args) => calls.push(args) });
  assert.deepEqual(calls, [['mediakey.ps1', ['-Vk', 0xb3]]]);
  await assert.rejects(sendMediaKey('eject', { run: async () => {} }), /Unknown media key/);
});
