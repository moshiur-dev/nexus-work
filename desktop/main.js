// Nexus Tracker: the Nexus Work web app in a desktop window, plus automatic time-tracking helpers.
// While a timer runs (and only then) it:
//   - counts key presses and mouse clicks across the whole computer (counts only, never which keys)
//   - takes screenshots of the main screen when the web app asks, without a share prompt
//   - lets screen recording start without the "choose a screen" dialog
// A tray icon shows when tracking is on, and the person can stop or quit at any time.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, desktopCapturer, screen, session, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- server address ----------
// Order: NEXUS_URL environment variable, then the saved setting, then the default above
// The deployed Nexus Work site. Settings → Server address can change it.
const DEFAULT_URL = 'https://nexus-work-lac.vercel.app';
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function cleanUrl(value) {
  const u = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Use an address starting with http:// or https://');
  return u.origin;
}

let APP_URL = DEFAULT_URL;
let APP_ORIGIN = DEFAULT_URL;
function loadServerUrl() {
  try {
    APP_URL = cleanUrl(process.env.NEXUS_URL || readConfig().serverUrl || DEFAULT_URL);
  } catch {
    APP_URL = DEFAULT_URL;
  }
  APP_ORIGIN = new URL(APP_URL).origin;
}

const SELFTEST = process.argv.includes('--selftest');

let win = null;
let tray = null;
let quitting = false;
let hook = null; // uiohook, loaded when first needed
let hookRunning = false;
const state = { active: false, taskName: '', screenshots: false };
const counts = { keys: 0, clicks: 0 };
const keysDown = new Set(); // ignore auto-repeat while a key is held

// ---------- global activity counting ----------
function loadHook() {
  if (hook) return hook;
  const { uIOhook } = require('uiohook-napi');
  uIOhook.on('keydown', (e) => {
    if (keysDown.has(e.keycode)) return;
    keysDown.add(e.keycode);
    counts.keys += 1;
  });
  uIOhook.on('keyup', (e) => keysDown.delete(e.keycode));
  uIOhook.on('mousedown', () => { counts.clicks += 1; });
  hook = uIOhook;
  return hook;
}

function setHook(on) {
  try {
    if (on && !hookRunning) { loadHook().start(); hookRunning = true; }
    if (!on && hookRunning) { hook.stop(); hookRunning = false; keysDown.clear(); }
  } catch (err) {
    console.error('Activity hook failed:', err.message);
  }
}

// ---------- screenshots ----------
async function captureMainScreen() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const scale = Math.min(1, 1600 / width);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const src = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('No screen available to capture');
  return src.thumbnail.toJPEG(70);
}

// ---------- tray ----------
// A small round icon drawn in code: purple when idle, green when tracking
function trayIcon(active) {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const [r, g, b] = active ? [34, 197, 94] : [123, 104, 238];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const i = (y * size + x) * 4;
      const a = d <= 7 ? 255 : d <= 8 ? Math.round((8 - d) * 255) : 0;
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a; // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function updateTray() {
  if (!tray) return;
  const label = state.active
    ? `Tracking: ${state.taskName}${state.screenshots ? ' · screenshots on' : ''}`
    : 'Not tracking';
  tray.setImage(trayIcon(state.active));
  tray.setToolTip(`Nexus Tracker — ${label}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: 'Open Nexus', click: showWindow },
    { label: `Server: ${APP_URL}`, enabled: false },
    { label: 'Server address…', click: () => openSettings(false) },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function showWindow() {
  if (!win) return createWindow();
  win.show();
  win.focus();
}

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: 'Nexus Tracker', body, silent: true }).show();
}

// ---------- IPC from the web app (only from the Nexus origin) ----------
function fromApp(event) {
  try {
    return new URL(event.senderFrame.url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

ipcMain.handle('tracker:set', (event, next) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  const wasActive = state.active;
  state.active = !!next?.active;
  state.taskName = String(next?.taskName || '').slice(0, 120);
  state.screenshots = !!next?.screenshots;
  if (state.active && !wasActive) {
    counts.keys = 0;
    counts.clicks = 0;
    notify(`Tracking time on “${state.taskName}”${state.screenshots ? ' with screenshots every 5–10 min' : ''}.`);
  }
  setHook(state.active);
  updateTray();
  return { global: hookRunning };
});

ipcMain.handle('tracker:take-activity', (event) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  const out = { keys: counts.keys, clicks: counts.clicks, global: hookRunning };
  counts.keys = 0;
  counts.clicks = 0;
  return out;
});

ipcMain.handle('tracker:capture', async (event) => {
  if (!fromApp(event)) throw new Error('Not allowed');
  if (!state.active || !state.screenshots) throw new Error('Screenshots are off');
  return captureMainScreen();
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    title: 'Nexus Work',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(APP_URL);
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) openSettings(true); // -3 is a cancelled load, not an error
  });

  // Links to other sites open in the normal browser; the window stays on Nexus
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== APP_ORIGIN) { e.preventDefault(); shell.openExternal(url); }
  });

  // Closing while a timer runs keeps the app in the tray so tracking continues
  win.on('close', (e) => {
    if (quitting || !state.active) return;
    e.preventDefault();
    win.hide();
    notify('Still tracking time. Use the tray icon to open Nexus or quit.');
  });
  win.on('closed', () => { win = null; });
}

// ---------- server address window ----------
let settingsWin = null;
let settingsOffline = false;

function openSettings(offline) {
  settingsOffline = offline;
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 480,
    height: offline ? 330 : 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: win || undefined,
    modal: !!win,
    title: 'Server address',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

const fromSettings = (event) => settingsWin && event.sender === settingsWin.webContents;

ipcMain.handle('settings:get', (event) => {
  if (!fromSettings(event)) throw new Error('Not allowed');
  return { serverUrl: APP_URL, offline: settingsOffline };
});

ipcMain.handle('settings:save', (event, value) => {
  if (!fromSettings(event)) throw new Error('Not allowed');
  let url;
  try {
    url = cleanUrl(value);
  } catch (err) {
    return { ok: false, error: err.message.startsWith('Use') ? err.message : 'That is not a valid web address' };
  }
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), serverUrl: url }, null, 2));
  loadServerUrl();
  updateTray();
  settingsWin?.close();
  if (win) win.loadURL(APP_URL); else createWindow();
  return { ok: true };
});

ipcMain.handle('settings:close', (event) => {
  if (!fromSettings(event)) throw new Error('Not allowed');
  settingsWin?.close();
  return true;
});

function allowScreenRecording() {
  // Screen recording from the web app starts with the main screen, without a picker
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (new URL(request.securityOrigin || request.frame?.url || '').origin !== APP_ORIGIN) return callback({});
    } catch {
      return callback({});
    }
    const primary = String(screen.getPrimaryDisplay().id);
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const src = sources.find((s) => s.display_id === primary) || sources[0];
    callback(src ? { video: src, audio: process.platform === 'win32' ? 'loopback' : undefined } : {});
  });
}

// ---------- self-test: checks capture and the input hook, then exits ----------
async function selftest() {
  const result = { platform: process.platform, electron: process.versions.electron };
  try {
    const jpg = await captureMainScreen();
    const size = nativeImage.createFromBuffer(jpg).getSize();
    result.screenshot = { ok: true, bytes: jpg.length, width: size.width, height: size.height };
  } catch (err) {
    result.screenshot = { ok: false, error: err.message };
  }
  try {
    setHook(true);
    result.inputHook = { ok: hookRunning };
    setHook(false);
  } catch (err) {
    result.inputHook = { ok: false, error: err.message };
  }
  console.log('SELFTEST ' + JSON.stringify(result));
  app.exit(0);
}

// ---------- app lifecycle ----------
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadServerUrl();
    if (SELFTEST) return selftest();
    allowScreenRecording();
    tray = new Tray(trayIcon(false));
    tray.on('click', showWindow);
    updateTray();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (!state.active) app.quit();
  });
}

// Asks before quitting while a timer runs, then stops the input hook
app.on('before-quit', (e) => {
  if (state.active && win && !SELFTEST) {
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      message: 'A timer is still running.',
      detail: 'Quitting stops screenshots and activity counts. Stop the timer in Nexus first if you are done.',
    });
    if (choice === 1) { e.preventDefault(); quitting = false; return; }
  }
  quitting = true;
  setHook(false);
});
