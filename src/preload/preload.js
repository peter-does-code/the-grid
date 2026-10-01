'use strict';

// Den eneste bro mellem rendereren og hovedprocessen. Rendereren har ingen Node-adgang.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('visamp', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  copyText: (text) => ipcRenderer.invoke('app:copyText', text),
  openSpotifyDashboard: () => ipcRenderer.invoke('app:openSpotifyDashboard'),
  audio: {
    currentDevice: () => ipcRenderer.invoke('audio:currentDevice'),
    onDevice: (callback) => subscribe('audio:device', callback),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    installNow: () => ipcRenderer.invoke('update:installNow'),
    onStatus: (callback) => subscribe('update:status', callback),
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    login: () => ipcRenderer.invoke('spotify:login'),
    logout: () => ipcRenderer.invoke('spotify:logout'),
    checkClientId: (clientId) => ipcRenderer.invoke('spotify:checkClientId', clientId),
    loadCollection: (input) => ipcRenderer.invoke('spotify:loadCollection', input),
    play: (target) => ipcRenderer.invoke('spotify:play', target),
    control: (action) => ipcRenderer.invoke('spotify:control', action),
    seek: (ms) => ipcRenderer.invoke('spotify:seek', ms),
    setVolume: (percent) => ipcRenderer.invoke('spotify:volume', percent),
    playbackState: () => ipcRenderer.invoke('spotify:playbackState'),
    queue: () => ipcRenderer.invoke('spotify:queue'),
    onLoadProgress: (callback) => subscribe('spotify:loadProgress', callback),
  },
  musictest: {
    getFile: () => ipcRenderer.invoke('musictest:file'),
    report: (data) => ipcRenderer.invoke('musictest:report', data),
  },
  review: {
    vote: (name, verdict) => ipcRenderer.invoke('review:vote', name, verdict),
  },
  presettest: {
    batch: (start, count) => ipcRenderer.invoke('presettest:batch', start, count),
    results: (list) => ipcRenderer.invoke('presettest:results', list),
    options: () => ipcRenderer.invoke('presettest:options'),
    sheet: (index, dataUrl) => ipcRenderer.invoke('presettest:sheet', index, dataUrl),
    report: (data) => ipcRenderer.invoke('presettest:report', data),
  },
  probe: {
    report: (data) => ipcRenderer.invoke('probe:report', data),
  },
  selftest: {
    onPhase: (callback) => subscribe('selftest:phase', callback),
    onCollect: (callback) => subscribe('selftest:collect', callback),
    onShow: (callback) => subscribe('selftest:show', callback),
    shown: (view) => ipcRenderer.send('selftest:shown', view),
    report: (data) => ipcRenderer.invoke('selftest:report', data),
  },
});
