// preload-settings.js — 설정 팝업 창이 쓰는 통로
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snowSettings', {
  get: () => ipcRenderer.invoke('settings-get'),
  set: (key, value) => ipcRenderer.send('settings-set', key, value),
  action: name => ipcRenderer.send('settings-action', name),
});
