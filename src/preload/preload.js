'use strict';

/**
 * Preload seguro: expõe ao painel apenas uma função de chamada por nome e a escuta de eventos
 * de uma lista fixa. Nenhuma API do Node/Electron é exposta diretamente.
 */
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['server-status', 'navigate']);

contextBridge.exposeInMainWorld('gateway', {
  invoke: (action, payload) => ipcRenderer.invoke('gw:invoke', String(action), payload ?? {}),
  on: (event, callback) => {
    if (!EVENTS.has(event) || typeof callback !== 'function') return () => {};
    const channel = 'gw:' + event;
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  platform: process.platform
});
