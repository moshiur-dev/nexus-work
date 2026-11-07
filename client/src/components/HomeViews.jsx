import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { timeAgo } from './ListView.jsx';

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// One task in a Home or My Tasks list; clicking opens it on its list
function TaskLine({ task, listName, onOpen }) {
  const today = startOfDay();
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const overdue = due && !task.closed && due < today;
  return (
    <button className="task-line" onClick={() => onOpen(task)} disabled={!task.list} title={task.list ? 'Open task' : 'Not in a list'}>
      <span className={`dot ${task.closed ? 'closed' : ''}`} />
      <span className={`ellipsis grow ${task.closed ? 'struck' : ''}`}>{task.name}</span>
      {listName && <small className="muted ellipsis tl-list">{listName}</small>}
      {due && <small className={`tl-due ${overdue ? 'overdue' : ''}`}>{due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>}
    </button>
  );
}

const listNames = (spaces) => Object.fromEntries(spaces.flatMap((s) => s.lists.map((l) => [l._id, `${s.name} / ${l.name}`])));

// ---------- Home ----------
export function HomeView({ user, spaces, onOpenTask, onGo }) {
  const [mine, setMine] = useState(null);
  const [recent, setRecent] = useState(null);
  const names = listNames(spaces);

  useEffect(() => {
    api.listTasks('?assignee=me&open=1&limit=100').then((r) => setMine(r.data)).catch(() => setMine([]));
    api.listTasks('?sort=updated&limit=8').then((r) => setRecent(r.data)).catch(() => setRecent([]));
  }, []);

  const today = startOfDay();
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
  const overdue = (mine || []).filter((t) => t.dueDate && new Date(t.dueDate) < today);
  const thisWeek = (mine || []).filter((t) => t.dueDate && new Date(t.dueDate) >= today && new Date(t.dueDate) < weekEnd);
  const sorted = [...(mine || [])].sort((a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="home">
      <p className="home-greet">{greeting}, <b>{user.name.split(' ')[0]}</b></p>
      <div className="stats">
        <Stat label="Assigned to me" value={mine?.length} icon="check" onClick={() => onGo('mywork')} />
        <Stat label="Due this week" value={mine && thisWeek.length} icon="calendar" />
        <Stat label="Overdue" value={mine && overdue.length} icon="clock" danger={overdue.length > 0} />
      </div>
      <div className="home-grid">
        <section className="home-card">
          <header><Icon name="check" size={16} /> My work <button className="link-btn" onClick={() => onGo('mywork')}>See all</button></header>
          {mine === null && <div className="muted">Loading…</div>}
          {mine?.length === 0 && <Empty text="Nothing assigned to you. Tasks you are assigned to show up here." />}
          {sorted.slice(0, 8).map((t) => <TaskLine key={t._id} task={t} listName={names[t.list]} onOpen={onOpenTask} />)}
        </section>
        <section className="home-card">
          <header><Icon name="clock" size={16} /> Recently updated</header>
          {recent === null && <div className="muted">Loading…</div>}
          {recent?.length === 0 && <Empty text="No tasks yet. Use Create to add one." />}
          {recent?.map((t) => <TaskLine key={t._id} task={t} listName={names[t.list]} onOpen={onOpenTask} />)}
        </section>
        <section className="home-card">
          <header><Icon name="folder" size={16} /> Lists</header>
          {spaces.every((s) => !s.lists.length) && <Empty text="Create a space and a list from the sidebar." />}
          {spaces.flatMap((s) => s.lists.map((l) => (
            <button key={l._id} className="task-line" onClick={() => onGo(`list:${l._id}`)}>
              <span className="space-badge" style={{ background: s.color }}>{s.name[0]?.toUpperCase()}</span>
              <span className="ellipsis grow">{l.name}</span>
              <small className="muted">{l.open} open</small>
            </button>
          )))}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, danger, onClick }) {
  return (
    <button className={`stat ${danger ? 'danger' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-ic"><Icon name={icon} size={18} /></span>
      <span><b>{value ?? '…'}</b><small>{label}</small></span>
    </button>
  );
}

const Empty = ({ text }) => <div className="empty muted">{text}</div>;

// ---------- My Tasks: everything assigned to me ----------
export function MyTasksView({ spaces, onOpenTask }) {
  const [tasks, setTasks] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const names = listNames(spaces);

  useEffect(() => {
    api.listTasks(`?assignee=me&limit=100${showDone ? '' : '&open=1'}`).then((r) => setTasks(r.data)).catch(() => setTasks([]));
  }, [showDone]);

  const today = startOfDay();
  const groups = [
    { id: 'overdue', label: 'Overdue', test: (t) => !t.closed && t.dueDate && new Date(t.dueDate) < today },
    { id: 'today', label: 'Today', test: (t) => !t.closed && t.dueDate && startOfDay(new Date(t.dueDate)).getTime() === today.getTime() },
    { id: 'later', label: 'Upcoming', test: (t) => !t.closed && t.dueDate && new Date(t.dueDate) >= new Date(today.getTime() + 86400000) },
    { id: 'none', label: 'No due date', test: (t) => !t.closed && !t.dueDate },
    { id: 'done', label: 'Done', test: (t) => t.closed },
  ];

  return (
    <div className="mytasks">
      <label className="check-row show-done"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done tasks</label>
      {tasks === null && <div className="muted">Loading…</div>}
      {tasks?.length === 0 && <Empty text="Nothing assigned to you. Open a task and add yourself under Assignees." />}
      {tasks && groups.map((g) => {
        const rows = tasks.filter(g.test);
        if (!rows.length) return null;
        return (
          <section key={g.id} className="home-card mt-card">
            <header className={g.id === 'overdue' ? 'danger' : ''}>{g.label} <span className="muted">{rows.length}</span></header>
            {rows.map((t) => <TaskLine key={t._id} task={t} listName={names[t.list]} onOpen={onOpenTask} />)}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Inbox: notifications ----------
const TYPE_ICON = { assigned: 'users', comment: 'chat', mention: 'chat', automation: 'bolt' };

export function InboxView({ onOpenTask, onCountChange }) {
  const [items, setItems] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.notifications(unreadOnly).then((r) => setItems(r.data)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [unreadOnly]);
  // New notifications appear without a reload
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [unreadOnly]);

  const open = async (n) => {
    if (!n.read) {
      await api.markNotification(n._id).catch(() => {});
      setItems((xs) => xs.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      onCountChange();
    }
    if (n.task && n.taskList) onOpenTask({ _id: n.task, list: n.taskList });
  };
  const readAll = async () => {
    await api.markAllNotifications().catch((err) => setError(err.message));
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    onCountChange();
  };

  return (
    <div className="inbox">
      <div className="inbox-bar">
        <div className="seg">
          <button className={!unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(false)}>All</button>
          <button className={unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(true)}>Unread</button>
        </div>
        <div className="grow" />
        <button className="btn small" onClick={readAll}>Mark all as read</button>
      </div>
      {error && <div className="err">{error}</div>}
      {items === null && <div className="muted">Loading…</div>}
      {items?.length === 0 && <Empty text={unreadOnly ? 'You are all caught up.' : 'When someone assigns you, comments on your tasks or @mentions you, it shows up here.'} />}
      {items?.map((n) => (
        <button key={n._id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => open(n)}>
          <span className={`notif-ic ${n.type}`}><Icon name={TYPE_ICON[n.type] || 'bell'} size={16} /></span>
          <span className="notif-text">
            <span>{n.text}</span>
            <small className="muted">{n.actorName ? `${n.actorName} · ` : ''}{timeAgo(n.createdAt)}</small>
          </span>
          {!n.read && <span className="unread-dot" aria-label="Unread" />}
        </button>
      ))}
    </div>
  );
}
