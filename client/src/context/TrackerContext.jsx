import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Time tracking for the logged-in user, shared by the whole app:
// - one running timer at a time
// - while it runs, counts key presses and mouse clicks inside this tab (counts only, never which keys)
// - optional screenshots every 5-10 minutes, only after the person picks a screen to share
// - screen recordings attached to a task
// Everything is visible in the top bar while it is on, and the person can stop it at any time.

const TrackerContext = createContext(null);
export const useTracker = () => useContext(TrackerContext);

const FLUSH_MS = 60 * 1000;
const MIN_SHOT_MS = 5 * 60 * 1000;
const MAX_SHOT_MS = 10 * 60 * 1000;

// Development only: localStorage "nexus.shotTestMs" shortens the screenshot gap so it can be tested quickly
function nextShotDelay() {
  const test = import.meta.env.DEV && Number(localStorage.getItem('nexus.shotTestMs'));
  if (test > 0) return test;
  return MIN_SHOT_MS + Math.random() * (MAX_SHOT_MS - MIN_SHOT_MS);
}

// Set by the Nexus Tracker desktop app (desktop/preload.js); missing in a normal browser
const desktop = typeof window !== 'undefined' ? window.nexusDesktop || null : null;

// Large recordings: the server gives an Google Drive upload session and the browser sends the video in pieces.
// Without Google Drive the server says { local: true } and the video goes through the server as before.
async function uploadRecordingFile(taskId, blob, seconds) {
  const s = await api.recordingSession(taskId);
  if (s.local) return api.uploadRecording(taskId, blob, seconds);
  const PIECE = 256 * 1024 * 12; // Google Drive wants pieces that are a multiple of 256 KB
  for (let start = 0; start < blob.size; start += PIECE) {
    const end = Math.min(start + PIECE, blob.size);
    const res = await fetch(s.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` },
      body: blob.slice(start, end),
    });
    if (!res.ok && res.status !== 308) throw new Error(`Recording upload failed (${res.status})`);
  }
  return api.recordingFinish({ task: taskId, rel: s.rel, seconds });
}

export const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function TrackerProvider({ children }) {
  const [running, setRunning] = useState(null); // time entry with taskName
  const [shotsOn, setShotsOn] = useState(false);
  const [shotCount, setShotCount] = useState(0);
  const [live, setLive] = useState({ keys: 0, clicks: 0 }); // counts for this entry, shown in the top bar
  const [recording, setRecording] = useState(null); // { taskId, taskName, startedAt }
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');

  const pending = useRef({ keys: 0, clicks: 0 }); // not yet sent to the server
  const runningRef = useRef(null);
  const shotStream = useRef(null);
  const shotTimer = useRef(null);
  const recorder = useRef(null);
  const desktopShots = useRef(false); // screenshots come from the desktop app, no share prompt
  const globalRef = useRef(false); // the desktop app counts keys and clicks across the whole computer
  const [globalCounts, setGlobalCounts] = useState(false);

  runningRef.current = running;

  // Resume a timer that was running before a reload.
  // In the desktop app screenshots carry on by themselves; in a browser they need a new screen choice.
  useEffect(() => {
    api.runningTimer().then((r) => {
      if (!r.data) return;
      setRunning(r.data);
      setLive({ keys: r.data.keystrokes || 0, clicks: r.data.clicks || 0 });
      if (desktop && r.data.screenshots) {
        desktopShots.current = true;
        setShotsOn(true);
        scheduleShot();
      }
    }).catch(() => {});
  }, []);

  // Tell the desktop app what is being tracked (it shows this in the tray and only counts while active)
  useEffect(() => {
    if (!desktop) return;
    desktop.setTracking({ active: !!running, taskName: running?.taskName || '', screenshots: !!running && shotsOn && desktopShots.current })
      .then((r) => { globalRef.current = !!r?.global; setGlobalCounts(!!r?.global); })
      .catch(() => {});
  }, [running?._id, running?.taskName, shotsOn]);

  const flush = useCallback(async (keepalive = false) => {
    const entry = runningRef.current;
    const { keys, clicks } = pending.current;
    if (!entry || (!keys && !clicks)) return;
    pending.current = { keys: 0, clicks: 0 };
    try {
      await api.addActivity(entry._id, { keystrokes: keys, clicks }, keepalive);
    } catch {
      // Put the counts back so the next flush retries them
      pending.current.keys += keys;
      pending.current.clicks += clicks;
    }
  }, []);

  // Count activity while a timer runs
  useEffect(() => {
    if (!running) return;
    // In the desktop app the whole computer is counted there, so skip the in-page count to avoid doubles
    const onKey = (e) => {
      if (e.repeat || globalRef.current) return;
      pending.current.keys += 1;
      setLive((l) => ({ ...l, keys: l.keys + 1 }));
    };
    const onClick = () => {
      if (globalRef.current) return;
      pending.current.clicks += 1;
      setLive((l) => ({ ...l, clicks: l.clicks + 1 }));
    };
    const onHide = () => flush(true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onClick, true);
    window.addEventListener('pagehide', onHide);
    const t = setInterval(() => flush(), FLUSH_MS);
    const poll = desktop && setInterval(async () => {
      try {
        const a = await desktop.takeActivity();
        globalRef.current = !!a.global;
        setGlobalCounts(!!a.global);
        if (a.global && (a.keys || a.clicks)) {
          pending.current.keys += a.keys;
          pending.current.clicks += a.clicks;
          setLive((l) => ({ keys: l.keys + a.keys, clicks: l.clicks + a.clicks }));
        }
      } catch { /* the desktop app is closing */ }
    }, 2000);
    return () => {
      if (poll) clearInterval(poll);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onClick, true);
      window.removeEventListener('pagehide', onHide);
      clearInterval(t);
    };
  }, [running?._id, flush]);

  // ---------- screenshots ----------
  const stopShots = useCallback(() => {
    clearTimeout(shotTimer.current);
    shotStream.current?.getTracks().forEach((t) => t.stop());
    shotStream.current = null;
    desktopShots.current = false;
    setShotsOn(false);
  }, []);

  const captureFrame = async (stream) => {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    const scale = Math.min(1, 1600 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.7));
  };

  const scheduleShot = useCallback(() => {
    clearTimeout(shotTimer.current);
    shotTimer.current = setTimeout(async () => {
      const entry = runningRef.current;
      const stream = shotStream.current;
      const fromDesktop = desktopShots.current;
      if (!entry || (!stream && !fromDesktop)) return;
      try {
        const blob = fromDesktop
          ? new Blob([await desktop.captureScreen()], { type: 'image/jpeg' })
          : await captureFrame(stream);
        if (blob) {
          await api.uploadScreenshot(entry._id, blob);
          setShotCount((n) => n + 1);
          emit('nexus:time-changed', { taskId: entry.task });
        }
      } catch (err) {
        setNotice(`Screenshot failed: ${err.message}`);
      }
      if (shotStream.current || desktopShots.current) scheduleShot();
    }, nextShotDelay());
  }, []);

  // Asks the browser to share a screen. Returns null if the person cancels.
  const askScreen = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice('This browser cannot capture the screen.');
      return null;
    }
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
    } catch {
      setNotice('Screen sharing was not allowed, so screenshots are off.');
      return null;
    }
  };

  const beginShots = useCallback((stream) => {
    shotStream.current = stream;
    setShotsOn(true);
    // If the person stops sharing from the browser bar, screenshots pause
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      shotStream.current = null;
      clearTimeout(shotTimer.current);
      setShotsOn(false);
      if (runningRef.current) setNotice('Screen sharing stopped, so screenshots are paused.');
    });
    scheduleShot();
  }, [scheduleShot]);

  // ---------- timer ----------
  const start = useCallback(async (task, wantShots) => {
    setNotice('');
    // The desktop app takes screenshots itself; a browser has to ask which screen to share
    const stream = wantShots && !desktop ? await askScreen() : null;
    const withShots = desktop ? !!wantShots : !!stream;
    await flush();
    stopShots();
    try {
      const res = await api.startTimer(task._id, withShots);
      if (runningRef.current && runningRef.current.task !== task._id) emit('nexus:time-changed', { taskId: runningRef.current.task, reload: true });
      pending.current = { keys: 0, clicks: 0 };
      setLive({ keys: 0, clicks: 0 });
      setShotCount(0);
      setRunning(res.data);
      if (desktop && withShots) {
        desktopShots.current = true;
        setShotsOn(true);
        scheduleShot();
      } else if (stream) {
        beginShots(stream);
      }
      emit('nexus:time-changed', { taskId: task._id });
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      setNotice(err.message);
    }
  }, [flush, stopShots, beginShots, scheduleShot]);

  const stop = useCallback(async () => {
    await flush();
    stopShots();
    try {
      const res = await api.stopTimer();
      setRunning(null);
      if (res.task) emit('nexus:task-updated', res.task);
      emit('nexus:time-changed', { taskId: res.data.task });
    } catch (err) {
      setRunning(null);
      setNotice(err.message);
    }
  }, [flush, stopShots]);

  // Turn screenshots on for the running timer (for example after a reload)
  const resumeShots = useCallback(async () => {
    const entry = runningRef.current;
    if (!entry) return;
    if (desktop) {
      try {
        await api.addActivity(entry._id, { keystrokes: 0, clicks: 0, screenshots: true });
        setRunning((r) => ({ ...r, screenshots: true }));
        desktopShots.current = true;
        setShotsOn(true);
        scheduleShot();
      } catch (err) {
        setNotice(err.message);
      }
      return;
    }
    const stream = await askScreen();
    if (!stream) return;
    try {
      await api.addActivity(entry._id, { keystrokes: 0, clicks: 0, screenshots: true });
      setRunning((r) => ({ ...r, screenshots: true }));
      beginShots(stream);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setNotice(err.message);
    }
  }, [beginShots, scheduleShot]);

  // ---------- screen recording ----------
  const startRecording = useCallback(async (task) => {
    setNotice('');
    if (recorder.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setNotice('This browser cannot record the screen.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      setNotice('Screen recording was not allowed.');
      return;
    }
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    const startedAt = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRecording(null);
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (!blob.size) return;
      setUploading(true);
      try {
        await uploadRecordingFile(task._id, blob, Math.round((Date.now() - startedAt) / 1000));
        emit('nexus:recordings-changed', { taskId: task._id });
      } catch (err) {
        setNotice(`Recording upload failed: ${err.message}`);
      } finally {
        setUploading(false);
      }
    };
    // Stopping the share from the browser bar also ends the recording
    stream.getVideoTracks()[0]?.addEventListener('ended', () => rec.state !== 'inactive' && rec.stop());
    rec.start(1000);
    recorder.current = rec;
    setRecording({ taskId: task._id, taskName: task.name, startedAt });
  }, []);

  const stopRecording = useCallback(() => {
    if (recorder.current?.state !== 'inactive') recorder.current?.stop();
  }, []);

  // Stop everything on logout or when the app unmounts
  useEffect(() => () => { stopShots(); recorder.current?.stop(); }, [stopShots]);

  const value = {
    running, shotsOn, shotCount, live, recording, uploading, notice, desktop: !!desktop, globalCounts,
    start, stop, resumeShots, startRecording, stopRecording, clearNotice: () => setNotice(''),
  };
  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtHours(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

// Ticks once a second while mounted
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// Top-bar indicator: running timer, live counts, screenshot state, recording
export function TrackerBar({ onOpenTask }) {
  const t = useTracker();
  const now = useNow(!!(t.running || t.recording));
  if (!t.running && !t.recording && !t.uploading && !t.notice) return null;
  return (
    <div className="tracker-bar">
      {t.running && (
        <div className="timer-chip" title="Time tracking is on">
          <span className="rec-dot" />
          <button className="timer-task ellipsis" onClick={() => onOpenTask(t.running)}>{t.running.taskName}</button>
          <b className="timer-time">{fmtDuration((now - new Date(t.running.start)) / 1000)}</b>
          {t.desktop && <span title="Nexus Tracker desktop app">🖥</span>}
          <span className="timer-stats" title={t.globalCounts ? 'Key presses and mouse clicks on this computer while the timer runs' : 'Key presses and mouse clicks in Nexus while the timer runs'}>⌨ {t.live.keys} · 🖱 {t.live.clicks}</span>
          {t.shotsOn ? (
            <span className="shots-on" title="Screenshots every 5-10 minutes">📸 {t.shotCount}</span>
          ) : (
            t.running.screenshots && <button className="link-btn shots-off" onClick={t.resumeShots} title="Share your screen again to resume screenshots">📸 paused</button>
          )}
          <button className="btn small stop-btn" onClick={t.stop}>■ Stop</button>
        </div>
      )}
      {t.recording && (
        <div className="timer-chip rec">
          <span className="rec-dot red" />
          <span className="ellipsis">REC {t.recording.taskName}</span>
          <b className="timer-time">{fmtDuration((now - t.recording.startedAt) / 1000)}</b>
          <button className="btn small stop-btn" onClick={t.stopRecording}>■ Stop</button>
        </div>
      )}
      {t.uploading && <div className="timer-chip muted">Uploading recording…</div>}
      {t.notice && (
        <div className="timer-chip notice">
          <span className="ellipsis">{t.notice}</span>
          <button className="mini-btn dark" aria-label="Dismiss" onClick={t.clearNotice}>✕</button>
        </div>
      )}
    </div>
  );
}
