// preload.js — 렌더러에 최소한의 네이티브 통로만 노출한다
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snowNative', {
  // { W, H, list: [{ id, kind, x0, x1, y, va, vb }] }  (좌표는 이 오버레이 창 기준 DIP)
  onSurfaces: cb => ipcRenderer.on('surfaces', (_e, data) => cb(data)),
  onCommand: cb => ipcRenderer.on('command', (_e, name, arg) => cb(name, arg)),
  // true 면 마우스가 오버레이를 통과해 아래 창으로 간다
  setIgnore: ignore => ipcRenderer.send('ignore-mouse', !!ignore),
  ready: () => ipcRenderer.send('ready'),
  openMenu: () => ipcRenderer.send('open-menu'),
  openSettings: () => ipcRenderer.send('open-settings'),
  log: msg => ipcRenderer.send('log', msg),
});
