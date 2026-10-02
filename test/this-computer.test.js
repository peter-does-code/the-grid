'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { isThisComputer, namesMatch, localComputerNames } = require('../src/main/this-computer.js');

test('Spotify-enheden genkendes på hostname eller COMPUTERNAME, uden forskel på store og små bogstaver', () => {
  const names = { hostname: 'peters-pc.lan', computerName: 'PETERS-PC' };
  assert.equal(isThisComputer('PETERS-PC', names), true);
  assert.equal(isThisComputer('  peters-pc ', names), true);
  assert.equal(isThisComputer('Peters-PC', { hostname: 'noget-andet', computerName: 'PETERS-PC' }), true, 'kun COMPUTERNAME passer');
  assert.equal(isThisComputer('Peters-PC', { hostname: 'peters-pc', computerName: null }), true, 'uden COMPUTERNAME');
  assert.equal(isThisComputer('Telefon', names), false);
  assert.equal(isThisComputer(undefined, names), false);
});

test('et navn uden domæne passer på det samme navn med domæne, men en bindestreg er ikke et skel', () => {
  assert.equal(namesMatch('DESKTOP-ABC', 'desktop-abc.lan'), true);
  assert.equal(namesMatch('desktop-abc.lan', 'DESKTOP-ABC'), true);
  assert.equal(namesMatch('DESKTOP', 'desktop-abc'), false, 'et falsk ja ville give -70 dB, mens Spotify spiller et andet sted');
  assert.equal(namesMatch('DESKTOP-AB', 'desktop-abc'), false, 'midt i et ord');
  assert.equal(namesMatch('DESKTOP-ABD', 'desktop-abc'), false);
  assert.equal(namesMatch('Web Player (Chrome)', 'desktop-abc'), false);
  assert.equal(namesMatch('', 'desktop-abc'), false);
  assert.equal(namesMatch(null, null), false, 'tomme navne passer aldrig');
});

test('pc-navnene læses fra os.hostname() og COMPUTERNAME', () => {
  const names = localComputerNames({ COMPUTERNAME: 'PETERS-PC' });
  assert.equal(names.hostname, os.hostname());
  assert.equal(names.computerName, 'PETERS-PC');
  assert.equal(localComputerNames({}).computerName, null);
});
