// Only for the local settings window (settings.html)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (url) => ipcRenderer.invoke('settings:save', url),
  close: () => ipcRenderer.invoke('settings:close'),
});
