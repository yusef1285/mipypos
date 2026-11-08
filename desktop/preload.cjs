'use strict';
// Narrow bridge used by lib/desktop.ts. The renderer never gets Node.js or raw IPC.
const { contextBridge, ipcRenderer } = require('electron');

const call =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('mipyDesktop', {
  version: '1',
  platform: process.platform,
  tls: {
    start: call('mipy:tls-start'),
    stop: call('mipy:tls-stop'),
    respond: (id, body) => ipcRenderer.send('mipy:tls-respond', String(id), String(body)),
    request: call('mipy:tls-request'),
    onRequest: (listener) => {
      const wrapped = (_event, request) =>
        listener({
          id: String(request.id),
          method: String(request.method),
          path: String(request.path),
          body: String(request.body),
        });
      ipcRenderer.on('mipy:tls-request', wrapped);
      return () => ipcRenderer.removeListener('mipy:tls-request', wrapped);
    },
  },
  network: { getHostIp: call('mipy:host-ip') },
  discovery: { advertise: call('mipy:advertise'), stop: call('mipy:advertise-stop') },
  secrets: {
    get: call('mipy:secret-get'),
    set: call('mipy:secret-set'),
    remove: call('mipy:secret-remove'),
  },
  deviceId: call('mipy:device-id'),
  backups: {
    folder: call('mipy:backup-folder'),
    save: call('mipy:backup-save'),
    list: call('mipy:backup-list'),
    pick: call('mipy:backup-pick'),
    openFolder: call('mipy:backup-open'),
  },
});
