// Gives the Nexus web app a small, fixed set of desktop features. Nothing else from Node or Electron is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusDesktop', {
  isDesktop: true,
  // Tells the app what is being tracked (shown in the tray); counting runs only while active
  setTracking: (state) => ipcRenderer.invoke('tracker:set', state),
  // Key presses and clicks since the last call, across the whole computer
  takeActivity: () => ipcRenderer.invoke('tracker:take-activity'),
  // JPEG of the main screen; only works while tracking with screenshots on
  captureScreen: () => ipcRenderer.invoke('tracker:capture'),
});
