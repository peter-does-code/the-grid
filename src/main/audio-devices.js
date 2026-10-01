'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { spawnScript } = require('./powershell');

const MAX_RESTARTS = 5;

// PowerShell-løkken ligger i src/main/ps/audio-watch.ps1: den læser Windows' standard-afspilningsenhed
// hvert sekund via Core Audio (ps/audio-devices.cs) og skriver "id|navn", når den ændrer sig.

/**
 * Hændelser:
 *   'device' ({id, name}, {changed})  første aflæsning (changed=false) og ved hvert skift (changed=true)
 *
 * Electrons loopback-lydfangst bliver på den enhed, der var standard, da den startede. Derfor skal
 * rendereren starte lydfangsten forfra, når brugeren skifter højttaler.
 */
class DefaultDeviceWatcher extends EventEmitter {
  constructor({ spawnImpl = spawn, log = console } = {}) {
    super();
    this.spawnImpl = spawnImpl;
    this.log = log;
    this.current = null;
    this.proc = null;
    this.stopped = false;
    this.restarts = 0;
  }

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    this.stopped = false;
    let proc;
    try {
      proc = spawnScript('audio-watch.ps1', [], { spawnImpl: this.spawnImpl });
    } catch (err) {
      this.log.error('Could not start the audio device watcher:', err);
      return;
    }
    this.proc = proc;
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        this.handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    let errors = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-2000); // gemmes kun til loggen, hvis scriptet stopper
    });
    proc.on('error', (err) => this.log.error('The audio device watcher failed to start:', err));
    proc.on('exit', (code) => {
      this.proc = null;
      if (!this.stopped && errors.trim()) this.log.warn(`The audio device watcher stopped (code ${code}):`, errors.trim());
      if (this.stopped || this.restarts >= MAX_RESTARTS) return;
      this.restarts += 1;
      const timer = setTimeout(() => this.start(), 5000);
      if (timer.unref) timer.unref();
    });
  }

  handleLine(line) {
    const text = String(line).replace(/^﻿/, '').trim();
    const separator = text.indexOf('|');
    if (separator <= 0) return; // aflæsningen fejlede kortvarigt, fx midt i et skift
    const device = { id: text.slice(0, separator), name: text.slice(separator + 1) };
    const previous = this.current;
    if (previous && previous.id === device.id) return;
    this.current = device;
    this.emit('device', device, { changed: Boolean(previous) });
  }

  stop() {
    this.stopped = true;
    if (this.proc) this.proc.kill();
    this.proc = null;
  }
}

module.exports = { DefaultDeviceWatcher };
