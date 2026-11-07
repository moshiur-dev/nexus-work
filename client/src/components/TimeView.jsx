import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTracker, useNow, fmtDuration, fmtHours } from '../context/TrackerContext.jsx';
import Icon from './Icon.jsx';
import { Shot, ShotViewer } from './ListView.jsx';

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const RANGES = [
  { id: 'today', label: 'Today', from: () => startOfDay() },
  { id: 'week', label: 'This week', from: () => { const d = startOfDay(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; } },
  { id: 'month', label: 'This month', from: () => { const d = startOfDay(); d.setDate(1); return d; } },
  { id: '30', label: 'Last 30 days', from: () => new Date(startOfDay().getTime() - 29 * 86400000) },
];
const dayLabel = (d) => {
  const day = startOfDay(d).getTime();
  if (day === startOfDay().getTime()) return 'Today';
  if (day === startOfDay().getTime() - 86400000) return 'Yesterday';
  return new Date(d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// Time tracking: start or stop a timer, see time per day, and every screenshot in one place
export default function TimeView({ members, onOpenTask }) {
  const { user } = useAuth();
  const isAdmin = ['owner', 'admin'].includes(user.role);
  const tracker = useTracker();
  const [range, setRange] = useState('week');
  const [who, setWho] = useState(''); // '' = me, 'all', or a member id (admins only)
  const [tab, setTab] = useState('entries');
  const [report, setReport] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    const from = RANGES.find((r) => r.id === range).from();
    api.timeEntries({ from: from.toISOString(), to: new Date(Date.now() + 86400000).toISOString(), user: who })
      .then(setReport).catch((err) => setError(err.message));
  };
  useEffect(() => { setReport(null); load(); }, [range, who]);
  // Refresh when a timer starts or stops, or a screenshot arrives
  useEffect(() => {
    const on = () => load();
    window.addEventListener('nexus:time-changed', on);
    return () => window.removeEventListener('nexus:time-changed', on);
  }, [range, who]);

  const remove = async (e) => {
    if (!window.confirm('Delete this time entry and its screenshots? This cannot be undone.')) return;
    try { await api.deleteTimeEntry(e._id); load(); } catch (err) { setError(err.message); }
  };

  const days = [];
  for (const e of report?.data || []) {
    const k = startOfDay(e.start).getTime();
    let d = days.find((x) => x.k === k);
    if (!d) { d = { k, label: dayLabel(e.start), entries: [], seconds: 0 }; days.push(d); }
    d.entries.push(e);
    d.seconds += e.seconds;
  }
  const showWho = isAdmin && who === 'all';

  return (
    <div className="timeview">
      <TimerCard members={members} onOpenTask={onOpenTask} />

      <div className="time-bar">
        <div className="seg">
          {RANGES.map((r) => <button key={r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>{r.label}</button>)}
        </div>
        {isAdmin && (
          <select className="in who-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose time">
            <option value="">My time</option>
            <option value="all">Everyone</option>
            {members.filter((m) => m.userId !== String(user.id)).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="err">{error}</div>}
      <div className="stats five">
        <Stat icon="clock" label="Time tracked" value={report ? fmtHours(report.totals.seconds) : '…'} />
        <Stat icon="list" label="Entries" value={report?.totals.entries ?? '…'} />
        <Stat icon="sliders" label="Key presses" value={report?.totals.keystrokes ?? '…'} />
        <Stat icon="check" label="Clicks" value={report?.totals.clicks ?? '…'} />
        <Stat icon="whiteboard" label="Screenshots" value={report?.totals.screenshots ?? '…'} onClick={() => setTab('shots')} />
      </div>

      <div className="tabs time-tabs">
        <button className={`tab ${tab === 'entries' ? 'on' : ''}`} onClick={() => setTab('entries')}><Icon name="list" size={16} /> Time entries</button>
        <button className={`tab ${tab === 'shots' ? 'on' : ''}`} onClick={() => setTab('shots')}><Icon name="whiteboard" size={16} /> Screenshots</button>
      </div>

      {report === null && <div className="muted">Loading…</div>}
      {report && days.length === 0 && (
        <div className="empty muted">No time tracked in this period. Pick a task above and press Start.</div>
      )}

      {tab === 'entries' && days.map((d) => (
        <section key={d.k} className="home-card day-card">
          <header>{d.label}<span className="muted day-total">{fmtHours(d.seconds)}</span></header>
          {d.entries.map((e) => (
            <div key={e._id} className="t-entry">
              <button className="link-plain ellipsis t-task" onClick={() => onOpenTask({ _id: e.task, list: e.taskList })} disabled={!e.taskList}>{e.taskName}</button>
              {showWho && <span className="muted t-who">{e.userName}</span>}
              <span className="muted t-time">{clock(e.start)} – {e.running ? 'now' : clock(e.end)}</span>
              <span className="t-stats muted">⌨ {e.keystrokes} · 🖱 {e.clicks}{e.screenshots ? ` · 📸 ${e.shots.length}` : ''}</span>
              <b className={`t-dur ${e.running ? 'live' : ''}`}>{e.running ? 'running' : fmtHours(e.seconds)}</b>
              {!e.running && (String(e.user) === String(user.id) || isAdmin) && (
                <button className="mini-btn dark" aria-label="Delete time entry" onClick={() => remove(e)}><Icon name="x" size={14} /></button>
              )}
            </div>
          ))}
        </section>
      ))}

      {tab === 'shots' && report && (
        <>
          {report.totals.screenshots === 0 && days.length > 0 && (
            <div className="empty muted">
              No screenshots in this period. Screenshots are taken only while a timer runs with "Take screenshots" ticked.
            </div>
          )}
          {days.filter((d) => d.entries.some((e) => e.shots.length)).map((d) => (
            <section key={d.k} className="home-card day-card">
              <header>{d.label}<span className="muted day-total">{d.entries.reduce((n, e) => n + e.shots.length, 0)} screenshots</span></header>
              {d.entries.filter((e) => e.shots.length).map((e) => (
                <div key={e._id} className="shot-group">
                  <div className="muted shot-group-head">
                    <b>{e.taskName}</b>{showWho ? ` · ${e.userName}` : ''} · {clock(e.start)} – {e.running ? 'now' : clock(e.end)}
                  </div>
                  <div className="shots big">
                    {e.shots.map((s) => <Shot key={s._id} id={s._id} takenAt={s.takenAt} onOpen={() => setViewing(s._id)} />)}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      <p className="muted small-note storage-note">
        Screenshots are saved on the server in <code>server/uploads/screenshots</code>. Only the person who took them and workspace owners and admins can see them.
      </p>
      {viewing && <ShotViewer id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Stat({ icon, label, value, onClick }) {
  return (
    <button className="stat" onClick={onClick} disabled={!onClick}>
      <span className="stat-ic"><Icon name={icon} size={18} /></span>
      <span><b>{value}</b><small>{label}</small></span>
    </button>
  );
}

// Start a timer on any open task, or see and stop the one running
function TimerCard({ onOpenTask }) {
  const tracker = useTracker();
  const [tasks, setTasks] = useState(null);
  const [taskId, setTaskId] = useState('');
  const [withShots, setWithShots] = useState(() => localStorage.getItem('nexus.withShots') === '1');
  const now = useNow(!!tracker.running);

  useEffect(() => {
    api.listTasks('?open=1&sort=updated&limit=100').then((r) => setTasks(r.data)).catch(() => setTasks([]));
  }, []);

  if (tracker.running) {
    const r = tracker.running;
    return (
      <section className="timer-card running">
        <span className="rec-dot" />
        <div className="grow tc-main">
          <small className="muted">Tracking now</small>
          <button className="link-plain tc-task ellipsis" onClick={() => onOpenTask({ _id: r.task, list: r.taskList })}>{r.taskName}</button>
          <small className="muted">
            ⌨ {tracker.live.keys} keys · 🖱 {tracker.live.clicks} clicks
            {tracker.shotsOn ? ` · 📸 ${tracker.shotCount} screenshots` : r.screenshots ? ' · screenshots paused' : ' · no screenshots'}
            {tracker.desktop ? ' · desktop app' : ''}
          </small>
        </div>
        <b className="tc-clock">{fmtDuration((now - new Date(r.start)) / 1000)}</b>
        {!tracker.shotsOn && r.screenshots && <button className="btn" onClick={tracker.resumeShots}>Resume screenshots</button>}
        <button className="btn stop-timer" onClick={tracker.stop}>■ Stop</button>
      </section>
    );
  }

  const chosen = tasks?.find((t) => t._id === taskId);
  return (
    <section className="timer-card">
      <span className="tc-ic"><Icon name="clock" size={22} /></span>
      <div className="grow tc-main">
        <select className="in" value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Task to track">
          <option value="">{tasks === null ? 'Loading tasks…' : tasks.length ? 'Choose a task to track…' : 'No open tasks — create one first'}</option>
          {tasks?.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
        </select>
        <label className="check-row shots-check">
          <input type="checkbox" checked={withShots} onChange={(e) => { setWithShots(e.target.checked); localStorage.setItem('nexus.withShots', e.target.checked ? '1' : '0'); }} />
          Take screenshots every 5–10 min{tracker.desktop ? '' : ' (your browser will ask which screen to share)'}
        </label>
      </div>
      <button className="btn primary tc-start" disabled={!chosen} onClick={() => tracker.start(chosen, withShots)}>▶ Start</button>
    </section>
  );
}
