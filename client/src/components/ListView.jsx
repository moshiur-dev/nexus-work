import { useEffect, useRef, useState } from 'react';
import { api, CLIENT_ID } from '../api.js';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTracker, useNow, fmtDuration, fmtHours } from '../context/TrackerContext.jsx';

// The statuses a list has when it has not set its own (same as the server's default)
export const DEFAULT_STATUSES = [
  { id: 'todo', name: 'To Do', color: '#87909e', type: 'open' },
  { id: 'prog', name: 'In Progress', color: '#5b8def', type: 'open' },
  { id: 'done', name: 'Done', color: '#16a34a', type: 'done' },
];
export const statusesOf = (list) => (list?.statuses?.length ? list.statuses : DEFAULT_STATUSES);
export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', color: '#ef4444' },
  { id: 'high', label: 'High', color: '#f59e0b' },
  { id: 'normal', label: 'Normal', color: '#5b8def' },
  { id: 'low', label: 'Low', color: '#94a3b8' },
];

const VIEW_KEY = 'nexus.viewMode';
const VIEWS = [
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'gantt', label: 'Gantt', icon: 'gantt' },
];

// One list's tasks, shown as a grouped List, a drag-and-drop Board or a month Calendar.
export default function ListView({ space, list, members, canWrite, onCountsChange, onRenameList, onDeleteList, onStatusesChange, openTaskId, onTaskOpened }) {
  const statuses = statusesOf(list);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'board');
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState('');
  const [editingStatuses, setEditingStatuses] = useState(false);
  const [error, setError] = useState('');

  const load = (openAfter) => api.listTasks(`?list=${list._id}&limit=100`)
    .then((r) => {
      setTasks(r.data);
      // Opened from search, the tracker or Create: show that task
      if (openAfter && r.data.some((t) => t._id === openAfter)) { setOpenId(openAfter); onTaskOpened?.(); }
    })
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    setOpenId(null);
    load(openTaskId);
  }, [list._id]);

  // Keep the sidebar's open-task count in step
  useEffect(() => {
    if (!loading) onCountsChange(list._id, tasks.length, tasks.filter((t) => !t.closed).length);
  }, [tasks, loading]);

  const pickView = (v) => { setView(v); localStorage.setItem(VIEW_KEY, v); };

  const create = async (name, status, extra = {}) => {
    setError('');
    try {
      const res = await api.createTask({ name, ...(status ? { status } : {}), list: list._id, ...extra });
      setTasks((ts) => [res.data, ...ts]);
    } catch (err) {
      setError(err.message);
    }
  };

  // Optimistic update: the UI changes at once and rolls back if the server refuses
  const update = async (id, patch) => {
    const before = tasks;
    const s = patch.status && statuses.find((x) => x.id === patch.status);
    const t0 = tasks.find((x) => x._id === id);
    const openBlockers = (t0?.blockedBy || []).map((b) => tasks.find((x) => x._id === String(b))).filter((b) => b && !b.closed);
    if (s?.type === 'done' && openBlockers.length && !window.confirm(`"${t0.name}" is still waiting on: ${openBlockers.map((b) => b.name).join(', ')}. Mark it done anyway?`)) return;
    setTasks((ts) => ts.map((t) => (t._id === id ? { ...t, ...patch, ...(s ? { closed: s.type === 'done' } : {}) } : t)));
    try {
      const res = await api.updateTask(id, patch);
      setTasks((ts) => {
        const next = ts.map((t) => (t._id === id ? res.data : t));
        return res.next && res.next.list === list._id && !next.some((t) => t._id === res.next._id) ? [res.next, ...next] : next;
      });
    } catch (err) {
      setTasks(before);
      setError(err.message);
    }
  };

  // Subtask and time calls return the whole task, which replaces the old copy
  const replace = (task) => setTasks((ts) => ts.map((t) => (t._id === task._id ? task : t)));

  // The tracker reports new time totals when a timer stops
  useEffect(() => {
    const onUpdated = (e) => replace(e.detail);
    window.addEventListener('nexus:task-updated', onUpdated);
    return () => window.removeEventListener('nexus:task-updated', onUpdated);
  }, []);

  // Live: someone else changed a task in this list, so reload it
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  useEffect(() => {
    let t = null;
    const onLive = (e) => {
      const ev = e.detail;
      if (ev.type !== 'task' || ev.by === CLIENT_ID) return;
      if (ev.list === list._id || tasksRef.current.some((x) => x._id === ev.id)) {
        clearTimeout(t);
        t = setTimeout(() => load(), 250);
      }
    };
    window.addEventListener('nexus:live', onLive);
    return () => { window.removeEventListener('nexus:live', onLive); clearTimeout(t); };
  }, [list._id]);

  const remove = async (id) => {
    setError('');
    try {
      await api.deleteTask(id);
      setTasks((ts) => ts.filter((t) => t._id !== id));
      setOpenId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const q = filter.trim().toLowerCase();
  const shown = q ? tasks.filter((t) => t.name.toLowerCase().includes(q)) : tasks;
  const open = tasks.find((t) => t._id === openId);
  const common = { tasks: shown, statuses, members, canWrite, onCreate: create, onOpen: setOpenId, onUpdate: update };

  return (
    <div className="listview">
      <div className="lv-head">
        <div className="crumbs">
          <span className="space-badge" style={{ background: space.color }}>{space.name[0]?.toUpperCase()}</span>
          <span className="muted">{space.name}</span>
          <span className="muted">/</span>
          <h1 className="lv-title">{list.name}</h1>
          {canWrite && <ListMenu onRename={onRenameList} onDelete={onDeleteList} onStatuses={() => setEditingStatuses(true)} />}
        </div>
        <div className="tabs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={`tab ${view === v.id ? 'on' : ''}`} onClick={() => pickView(v.id)}>
              <Icon name={v.icon} size={16} /> {v.label}
            </button>
          ))}
          <div className="grow" />
          <input className="in filter-in" placeholder="Filter tasks" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tasks" />
        </div>
      </div>

      {error && <div className="err server">{error}</div>}
      {loading ? (
        <div className="muted">Loading…</div>
      ) : view === 'list' ? (
        <GroupedList {...common} />
      ) : view === 'calendar' ? (
        <Calendar {...common} />
      ) : view === 'table' ? (
        <Table {...common} />
      ) : view === 'gantt' ? (
        <Gantt {...common} />
      ) : (
        <Board {...common} />
      )}

      {open && (
        <TaskPanel key={open._id} task={open} tasks={tasks} statuses={statuses} members={members} canWrite={canWrite}
          onClose={() => setOpenId(null)} onUpdate={(p) => update(open._id, p)} onDelete={() => remove(open._id)} onReplace={replace} />
      )}
      {editingStatuses && (
        <StatusEditor list={list} statuses={statuses} onClose={() => setEditingStatuses(false)}
          onSaved={(next) => { onStatusesChange?.(next); setEditingStatuses(false); load(); }} />
      )}
    </div>
  );
}

function ListMenu({ onRename, onDelete, onStatuses }) {
  const [show, setShow] = useState(false);
  return (
    <span className="lv-menu">
      <button className="mini-btn dark" aria-label="List actions" onClick={() => setShow(!show)}><Icon name="dots" size={16} /></button>
      {show && (
        <div className="tree-menu pop" onMouseLeave={() => setShow(false)}>
          <button onClick={() => { setShow(false); onStatuses(); }}>Edit statuses</button>
          <button onClick={() => { setShow(false); onRename(); }}>Rename list</button>
          <button className="danger" onClick={() => { setShow(false); onDelete(); }}>Delete list</button>
        </div>
      )}
    </span>
  );
}

// Clicking the circle closes an open task (first "done" status) or reopens a closed one (first "open" status)
const toggleStatus = (t, statuses) => (t.closed ? statuses.find((s) => s.type === 'open') : statuses.find((s) => s.type === 'done'))?.id;
const assigneesOf = (t, members) => (t.assignees || []).map((id) => members.find((m) => m.userId === id)).filter(Boolean);

// ---------- List view: tasks grouped by status ----------
function GroupedList({ tasks, statuses, members, canWrite, onCreate, onOpen, onUpdate }) {
  const [hidden, setHidden] = useState({});
  return (
    <div className="groups">
      {statuses.map((s) => {
        const rows = tasks.filter((t) => t.status === s.id);
        return (
          <section key={s.id} className="group">
            <div className="group-head" onClick={() => setHidden({ ...hidden, [s.id]: !hidden[s.id] })}>
              <span className={`caret ${hidden[s.id] ? 'shut' : ''}`}><Icon name="chevron" size={12} /></span>
              <span className="status-chip" style={{ background: s.color }}>{s.name}</span>
              <span className="muted">{rows.length}</span>
            </div>
            {!hidden[s.id] && (
              <div className="group-body">
                <div className="task-row head">
                  <span>Name</span><span>Assignee</span><span>Due date</span><span>Priority</span>
                </div>
                {rows.map((t) => (
                  <div key={t._id} className="task-row" onClick={() => onOpen(t._id)}>
                    <span className="name-cell">
                      <button
                        className="status-dot" style={{ borderColor: s.color, background: t.closed ? s.color : 'transparent' }}
                        title={t.closed ? 'Reopen' : 'Mark done'} aria-label={t.closed ? 'Reopen task' : 'Mark task done'} disabled={!canWrite}
                        onClick={(e) => { e.stopPropagation(); onUpdate(t._id, { status: toggleStatus(t, statuses) }); }}
                      />
                      <span className={`ellipsis ${t.closed ? 'struck' : ''}`}>{t.name}</span>
                      <Blocked task={t} tasks={tasks} />
                      <SubCount task={t} />
                      <TimeBadge task={t} />
                    </span>
                    <span><AvatarStack users={assigneesOf(t, members)} /></span>
                    <span className={dueClass(t)}>{fmtDate(t.dueDate)}</span>
                    <span><PriorityFlag id={t.priority} /></span>
                  </div>
                ))}
                {canWrite && <QuickAdd placeholder="+ Add task" onAdd={(name) => onCreate(name, s.id)} />}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Board view: columns by status, drag a card to move it ----------
function Board({ tasks, statuses, members, canWrite, onCreate, onOpen, onUpdate }) {
  const [over, setOver] = useState(null);
  const drop = (e, status) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/task');
    const t = tasks.find((x) => x._id === id);
    if (t && t.status !== status) onUpdate(id, { status });
  };
  return (
    <div className="board-cols" style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(230px, 1fr))` }}>
      {statuses.map((s) => {
        const cards = tasks.filter((t) => t.status === s.id);
        return (
          <div key={s.id} className={`col ${over === s.id ? 'over' : ''}`}
            onDragOver={(e) => { if (canWrite) { e.preventDefault(); setOver(s.id); } }}
            onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, s.id)}>
            <div className="col-head" style={{ borderTopColor: s.color }}>
              <span className="status-chip" style={{ background: s.color }}>{s.name}</span>
              <span className="muted">{cards.length}</span>
            </div>
            <div className="col-body">
              {cards.map((t) => (
                <div key={t._id} className="task-card" draggable={canWrite}
                  onDragStart={(e) => e.dataTransfer.setData('text/task', t._id)} onClick={() => onOpen(t._id)}>
                  <div className={`card-name ${t.closed ? 'struck' : ''}`}>{t.name}</div>
                  {(t.tags || []).length > 0 && (
                    <div className="card-tags">{t.tags.map((g) => <span key={g} className="tag">{g}</span>)}</div>
                  )}
                  <div className="card-meta">
                    <AvatarStack users={assigneesOf(t, members)} />
                    <Blocked task={t} tasks={tasks} />
                    <SubCount task={t} />
                    <TimeBadge task={t} />
                    {t.dueDate && <span className={dueClass(t)}><Icon name="calendar" size={13} /> {fmtDate(t.dueDate)}</span>}
                    <span className="grow" />
                    <PriorityFlag id={t.priority} />
                  </div>
                  {/* Touch screens cannot drag, so the card also has a move menu */}
                  {canWrite && (
                    <select className="card-move" value={t.status} aria-label="Move to status"
                      onClick={(e) => e.stopPropagation()} onChange={(e) => onUpdate(t._id, { status: e.target.value })}>
                      {statuses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  )}
                </div>
              ))}
              {canWrite && <QuickAdd placeholder="+ Add task" onAdd={(name) => onCreate(name, s.id)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Calendar view: tasks on their due dates ----------
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Calendar({ tasks, statuses, canWrite, onCreate, onOpen }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [adding, setAdding] = useState(null); // day key with an open "add task" box
  const todayKey = dayKey(new Date());

  // Six weeks starting on the Monday on or before the 1st
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const byDay = {};
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const k = dayKey(new Date(t.dueDate));
    (byDay[k] = byDay[k] || []).push(t);
  }
  const unscheduled = tasks.filter((t) => !t.dueDate && !t.closed).length;
  const color = (t) => statuses.find((s) => s.id === t.status)?.color || '#87909e';
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="calendar">
      <div className="cal-bar">
        <button className="btn small" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><span className="rot90"><Icon name="chevron" size={16} /></span></button>
        <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><span className="rot-90"><Icon name="chevron" size={16} /></span></button>
        <b className="cal-title">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        <div className="grow" />
        {unscheduled > 0 && <span className="muted small-note">{unscheduled} open task{unscheduled > 1 ? 's' : ''} without a due date</span>}
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="cal-wd">{w}</div>)}
        {days.map((d) => {
          const k = dayKey(d);
          const list = byDay[k] || [];
          return (
            <div key={k} className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${k === todayKey ? 'today' : ''}`}>
              <div className="cal-num">
                <span>{d.getDate()}</span>
                {canWrite && <button className="mini-btn dark cal-add" aria-label={`Add task on ${k}`} onClick={() => setAdding(k)}><Icon name="plus" size={13} /></button>}
              </div>
              {list.slice(0, 4).map((t) => (
                <button key={t._id} className={`cal-task ${t.closed ? 'struck' : ''}`} style={{ borderLeftColor: color(t) }} onClick={() => onOpen(t._id)} title={t.name}>
                  {t.name}
                </button>
              ))}
              {list.length > 4 && <span className="muted cal-more">+{list.length - 4} more</span>}
              {adding === k && (
                <QuickAdd placeholder="Task name" autoFocus onCancel={() => setAdding(null)}
                  onAdd={(name) => { onCreate(name, null, { dueDate: new Date(`${k}T12:00:00`).toISOString() }); setAdding(null); }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Table view: one row per task, editable cells, sortable columns ----------
const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const fromDateInput = (v) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

function Table({ tasks, statuses, members, canWrite, onOpen, onUpdate }) {
  const [sort, setSort] = useState({ key: 'status', dir: 1 });
  const statusIndex = Object.fromEntries(statuses.map((s, i) => [s.id, i]));
  const value = {
    name: (t) => t.name.toLowerCase(),
    status: (t) => statusIndex[t.status] ?? 99,
    start: (t) => (t.startDate ? new Date(t.startDate).getTime() : Infinity),
    due: (t) => (t.dueDate ? new Date(t.dueDate).getTime() : Infinity),
    priority: (t) => PRIORITY_ORDER[t.priority] ?? 9,
    estimate: (t) => t.timeEstimate ?? Infinity,
    tracked: (t) => t.timeSpent || 0,
  };
  const rows = [...tasks].sort((a, b) => {
    const x = value[sort.key](a), y = value[sort.key](b);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const head = (key, label) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))} className="sortable" aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key && <span className={sort.dir > 0 ? '' : 'rot180'}><Icon name="chevron" size={12} /></span>}
    </th>
  );
  return (
    <div className="table-wrap task-table">
      <table>
        <thead>
          <tr>
            {head('name', 'Name')}{head('status', 'Status')}<th>Assignees</th>{head('start', 'Start')}{head('due', 'Due')}
            {head('priority', 'Priority')}{head('estimate', 'Estimate')}{head('tracked', 'Tracked')}<th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan="9" className="muted">No tasks.</td></tr>}
          {rows.map((t) => {
            const st = statuses.find((s) => s.id === t.status);
            return (
              <tr key={t._id}>
                <td className="tt-name"><button className="link-plain ellipsis" onClick={() => onOpen(t._id)}><span className={t.closed ? 'struck' : ''}>{t.name}</span></button></td>
                <td>
                  <select className="cell-select" style={{ background: st?.color }} value={t.status} disabled={!canWrite} onChange={(e) => onUpdate(t._id, { status: e.target.value })} aria-label="Status">
                    {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td><AvatarStack users={assigneesOf(t, members)} /></td>
                <td><input className="cell-date" type="date" value={toDateInput(t.startDate)} disabled={!canWrite} onChange={(e) => onUpdate(t._id, { startDate: fromDateInput(e.target.value) })} aria-label="Start date" /></td>
                <td><input className={`cell-date ${dueClass(t)}`} type="date" value={toDateInput(t.dueDate)} disabled={!canWrite} onChange={(e) => onUpdate(t._id, { dueDate: fromDateInput(e.target.value) })} aria-label="Due date" /></td>
                <td>
                  <select className="cell-plain" value={t.priority || ''} disabled={!canWrite} onChange={(e) => onUpdate(t._id, { priority: e.target.value || null })} aria-label="Priority">
                    <option value="">—</option>
                    {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </td>
                <td className="muted">{t.timeEstimate ? fmtHours(t.timeEstimate * 60) : '—'}</td>
                <td className="muted">{t.timeSpent ? fmtHours(t.timeSpent) : '—'}</td>
                <td>{(t.tags || []).map((g) => <span key={g} className="tag">{g}</span>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Gantt view: bars from start to due date; drag to move, drag the end to resize ----------
const DAY = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const DAY_W = 34;

function Gantt({ tasks, statuses, canWrite, onOpen, onUpdate }) {
  const [from, setFrom] = useState(() => {
    const d = startOfDay(new Date(Date.now() - 7 * DAY));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    return d;
  });
  const [drag, setDrag] = useState(null); // { id, mode: 'move'|'end', x0, days }
  const DAYS = 42;
  const days = Array.from({ length: DAYS }, (_, i) => new Date(from.getTime() + i * DAY));
  const today = startOfDay(new Date());
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  const undated = tasks.filter((t) => !t.startDate && !t.dueDate);
  const color = (t) => statuses.find((s) => s.id === t.status)?.color || '#87909e';
  const span = (t) => {
    const s = startOfDay(t.startDate || t.dueDate);
    const e = startOfDay(t.dueDate || t.startDate);
    return { s, e };
  };

  const onDown = (e, t, mode) => {
    if (!canWrite) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not a real pointer */ }
    setDrag({ id: t._id, mode, x0: e.clientX, days: 0, moved: false });
  };
  const onMove = (e) => {
    if (!drag) return;
    const days = Math.round((e.clientX - drag.x0) / DAY_W);
    if (days !== drag.days || Math.abs(e.clientX - drag.x0) > 3) setDrag({ ...drag, days, moved: drag.moved || Math.abs(e.clientX - drag.x0) > 3 });
  };
  const onUp = (t) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) { onOpen(t._id); return; }
    if (!d.days) return;
    const add = (v) => (v ? new Date(new Date(v).getTime() + d.days * DAY).toISOString() : v);
    if (d.mode === 'move') {
      onUpdate(t._id, { ...(t.startDate ? { startDate: add(t.startDate) } : {}), ...(t.dueDate ? { dueDate: add(t.dueDate) } : {}) });
    } else {
      const { s } = span(t);
      const newDue = new Date(new Date(t.dueDate || t.startDate).getTime() + d.days * DAY);
      if (startOfDay(newDue) >= s) onUpdate(t._id, { dueDate: newDue.toISOString(), ...(t.startDate ? {} : { startDate: t.dueDate }) });
    }
  };

  return (
    <div className="gantt">
      <div className="cal-bar">
        <button className="btn small" onClick={() => { const d = startOfDay(new Date(Date.now() - 7 * DAY)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); setFrom(d); }}>Today</button>
        <button className="icon-btn" aria-label="Earlier" onClick={() => setFrom(new Date(from.getTime() - 14 * DAY))}><span className="rot90"><Icon name="chevron" size={16} /></span></button>
        <button className="icon-btn" aria-label="Later" onClick={() => setFrom(new Date(from.getTime() + 14 * DAY))}><span className="rot-90"><Icon name="chevron" size={16} /></span></button>
        <b className="cal-title">{days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {days[DAYS - 1].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b>
        <div className="grow" />
        <span className="muted small-note">Drag a bar to move it, drag its right edge to change the due date</span>
      </div>
      <div className="gantt-scroll">
        <div className="gantt-grid" style={{ gridTemplateColumns: `220px ${DAYS * DAY_W}px` }}>
          <div className="g-corner">Task</div>
          <div className="g-days">
            {days.map((d) => (
              <div key={d.getTime()} className={`g-day ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''} ${d.getTime() === today.getTime() ? 'today' : ''}`} style={{ width: DAY_W }}>
                <small>{d.toLocaleDateString(undefined, { weekday: 'narrow' })}</small>{d.getDate()}
              </div>
            ))}
          </div>
          {dated.map((t) => {
            const { s, e } = span(t);
            let left = Math.round((s - from) / DAY);
            let width = Math.round((e - s) / DAY) + 1;
            if (drag?.id === t._id) {
              if (drag.mode === 'move') left += drag.days; else width = Math.max(1, width + drag.days);
            }
            const visible = left + width > 0 && left < DAYS;
            return (
              <div key={t._id} className="g-row">
                <button className="g-name link-plain ellipsis" onClick={() => onOpen(t._id)} title={t.name}><span className={t.closed ? 'struck' : ''}>{t.name}</span></button>
                <div className="g-track" style={{ width: DAYS * DAY_W }}>
                  {Math.round((today - from) / DAY) >= 0 && Math.round((today - from) / DAY) < DAYS && <span className="g-today" style={{ left: Math.round((today - from) / DAY) * DAY_W + DAY_W / 2 }} />}
                  {visible && (
                    <div className={`g-bar ${t.closed ? 'closed' : ''} ${drag?.id === t._id ? 'dragging' : ''}`}
                      style={{ left: Math.max(0, left) * DAY_W + 2, width: Math.max(1, Math.min(width + Math.min(0, left), DAYS - Math.max(0, left))) * DAY_W - 4, background: color(t) }}
                      onPointerDown={(e) => onDown(e, t, 'move')} onPointerMove={onMove} onPointerUp={() => onUp(t)}
                      title={`${t.name}: ${s.toLocaleDateString()} – ${e.toLocaleDateString()}`}>
                      <span className="ellipsis">{t.name}</span>
                      {canWrite && <span className="g-handle" onPointerDown={(ev) => onDown(ev, t, 'end')} onPointerMove={onMove} onPointerUp={() => onUp(t)} />}
                    </div>
                  )}
                  {!visible && <span className="g-off muted">{left < 0 ? '← earlier' : 'later →'}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {dated.length === 0 && <div className="muted empty">No task has a start or due date yet. Add dates in a task to see it here.</div>}
      {undated.length > 0 && (
        <div className="g-undated">
          <b>No dates</b> <span className="muted">{undated.length}</span>
          <div className="g-undated-list">
            {undated.map((t) => <button key={t._id} className="chip" onClick={() => onOpen(t._id)}>{t.name}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Dependencies in the task popup ----------
function Dependencies({ task, tasks, canWrite, onUpdate }) {
  const [info, setInfo] = useState({ waitingOn: [], blocking: [] });
  useEffect(() => {
    api.taskDependencies(task._id).then(setInfo).catch(() => {});
    // Refetch after the server saves (updatedAt changes), not on the optimistic local change
  }, [task._id, task.updatedAt]);
  const ids = (task.blockedBy || []).map(String);
  const candidates = tasks.filter((t) => t._id !== task._id && !ids.includes(t._id));
  const openBlockers = info.waitingOn.filter((t) => !t.closed);

  return (
    <section className="panel-sec">
      <div className="sec-head"><b>Dependencies</b>{openBlockers.length > 0 && <span className="blocked-pill">Blocked by {openBlockers.length}</span>}</div>
      <div className="dep-group">
        <small className="muted">Waiting on</small>
        <div className="assignees">
          {info.waitingOn.map((t) => (
            <span key={t._id} className={`chip ${t.closed ? 'dep-done' : ''}`}>
              <Icon name={t.closed ? 'check' : 'clock'} size={13} /> {t.name}
              {canWrite && <button className="chip-x" aria-label={`Stop waiting on ${t.name}`} onClick={() => onUpdate({ blockedBy: ids.filter((x) => x !== t._id) })}><Icon name="x" size={12} /></button>}
            </span>
          ))}
          {canWrite && candidates.length > 0 && (
            <select className="in chip-add" value="" onChange={(e) => e.target.value && onUpdate({ blockedBy: [...ids, e.target.value] })} aria-label="Add a task this one waits on">
              <option value="">+ Add</option>
              {candidates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          )}
          {info.waitingOn.length === 0 && !canWrite && <span className="muted">Nothing</span>}
        </div>
      </div>
      {info.blocking.length > 0 && (
        <div className="dep-group">
          <small className="muted">Blocking</small>
          <div className="assignees">{info.blocking.map((t) => <span key={t._id} className="chip"><Icon name="bolt" size={13} /> {t.name}</span>)}</div>
        </div>
      )}
    </section>
  );
}

const REPEATS = [
  { id: '', label: 'Does not repeat', value: null },
  { id: 'day-1', label: 'Every day', value: { every: 'day', interval: 1 } },
  { id: 'week-1', label: 'Every week', value: { every: 'week', interval: 1 } },
  { id: 'week-2', label: 'Every 2 weeks', value: { every: 'week', interval: 2 } },
  { id: 'month-1', label: 'Every month', value: { every: 'month', interval: 1 } },
];
const repeatId = (r) => (r ? `${r.every}-${r.interval}` : '');

// Shows "Blocked" when the task waits on an unfinished task in this list
function Blocked({ task, tasks }) {
  const open = (task.blockedBy || []).filter((b) => tasks.some((t) => t._id === String(b) && !t.closed)).length;
  if (!open) return null;
  return <span className="blocked-pill" title={`Waiting on ${open} unfinished task${open > 1 ? 's' : ''}`}>Blocked</span>;
}

// ---------- Edit a list's statuses ----------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'status';
const PALETTE = ['#87909e', '#5b8def', '#7b68ee', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#16a34a'];

function StatusEditor({ list, statuses, onClose, onSaved }) {
  const [rows, setRows] = useState(statuses.map((s) => ({ ...s })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = () => setRows((r) => [...r, { id: '', name: '', color: PALETTE[r.length % PALETTE.length], type: 'open' }]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    const used = new Set(rows.filter((r) => r.id).map((r) => r.id));
    // New statuses get an id made from their name
    const out = rows.map((r) => {
      if (r.id) return { ...r, name: r.name.trim() };
      let id = slug(r.name);
      let n = 2;
      while (used.has(id)) id = `${slug(r.name)}-${n++}`;
      used.add(id);
      return { ...r, id, name: r.name.trim() };
    });
    setSaving(true);
    try {
      const res = await api.updateStatuses(list._id, out);
      onSaved(res.data.statuses);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <form className="task-modal new-task status-editor" role="dialog" aria-modal="true" aria-label="Edit statuses" onSubmit={save}>
        <div className="panel-top"><b>Statuses for {list.name}</b><div className="grow" /><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <p className="muted small-note">Tasks in a removed status move to the first open status. "Done" statuses count as finished.</p>
        {rows.map((r, i) => (
          <div key={i} className="status-row">
            <input type="color" value={r.color} onChange={(e) => set(i, { color: e.target.value })} aria-label="Status color" />
            <input className="in" value={r.name} maxLength={30} required placeholder="Status name" onChange={(e) => set(i, { name: e.target.value })} />
            <select className="in" value={r.type} onChange={(e) => set(i, { type: e.target.value })} aria-label="Status type">
              <option value="open">Open</option>
              <option value="done">Done</option>
            </select>
            <button type="button" className="mini-btn dark" aria-label="Move up" onClick={() => move(i, -1)}><span className="rot180"><Icon name="chevron" size={14} /></span></button>
            <button type="button" className="mini-btn dark" aria-label="Move down" onClick={() => move(i, 1)}><Icon name="chevron" size={14} /></button>
            <button type="button" className="mini-btn dark" aria-label="Remove status" disabled={rows.length <= 2} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
          </div>
        ))}
        {rows.length < 15 && <button type="button" className="btn small" onClick={add}><Icon name="plus" size={14} /> Add status</button>}
        {error && <div className="err server">{error}</div>}
        <div className="row modal-actions">
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save statuses'}</button>
        </div>
      </form>
    </>
  );
}

// ---------- Task details panel ----------
function TaskPanel({ task, tasks, statuses, members, canWrite, onClose, onUpdate, onDelete, onReplace }) {
  const [name, setName] = useState(task.name);
  const [desc, setDesc] = useState(task.description || '');
  const [tags, setTags] = useState((task.tags || []).join(', '));
  const [estimate, setEstimate] = useState(task.timeEstimate ? String(task.timeEstimate / 60) : '');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveName = () => { const v = name.trim(); if (v && v !== task.name) onUpdate({ name: v }); else setName(task.name); };
  const saveDesc = () => { if (desc !== (task.description || '')) onUpdate({ description: desc }); };
  const saveTags = () => {
    const list = tags.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.join(',') !== (task.tags || []).join(',')) onUpdate({ tags: list });
  };
  // Estimate is typed in hours (1.5 = 1h 30m) and stored in minutes
  const saveEstimate = () => {
    const h = parseFloat(estimate);
    const minutes = estimate.trim() === '' || !(h >= 0) ? null : Math.round(h * 60);
    if (minutes !== (task.timeEstimate ?? null)) onUpdate({ timeEstimate: minutes });
  };
  const due = task.dueDate ? task.dueDate.slice(0, 10) : '';
  const status = statuses.find((s) => s.id === task.status);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="task-modal" role="dialog" aria-modal="true" aria-label="Task details">
        <div className="panel-top">
          <span className="status-chip" style={{ background: status?.color || '#87909e' }}>{status?.name || task.status}</span>
          <div className="grow" />
          {canWrite && (
            <button className="btn small danger-btn" onClick={() => { if (window.confirm(`Delete "${task.name}"? This cannot be undone.`)) onDelete(); }}>Delete</button>
          )}
          <button className="icon-btn" aria-label="Close task" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body">
        <div className="modal-main">
        <input className="panel-name" value={name} disabled={!canWrite} maxLength={200}
          onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} aria-label="Task name" />

        <div className="fields">
          <label>Status</label>
          <select className="in" value={task.status} disabled={!canWrite} onChange={(e) => onUpdate({ status: e.target.value })}>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <label>Assignees</label>
          <AssigneePicker value={task.assignees || []} members={members} disabled={!canWrite} onChange={(assignees) => onUpdate({ assignees })} />

          <label>Priority</label>
          <select className="in" value={task.priority || ''} disabled={!canWrite} onChange={(e) => onUpdate({ priority: e.target.value || null })}>
            <option value="">No priority</option>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          <label>Dates</label>
          <div className="date-pair">
            <input className="in" type="date" value={toDateInput(task.startDate)} disabled={!canWrite} aria-label="Start date"
              onChange={(e) => onUpdate({ startDate: fromDateInput(e.target.value) })} />
            <span className="muted">→</span>
            <input className="in" type="date" value={due} disabled={!canWrite} aria-label="Due date"
              onChange={(e) => onUpdate({ dueDate: fromDateInput(e.target.value) })} />
          </div>

          <label>Repeat</label>
          <select className="in" value={repeatId(task.recurrence)} disabled={!canWrite} aria-label="Repeat"
            onChange={(e) => onUpdate({ recurrence: REPEATS.find((r) => r.id === e.target.value)?.value ?? null })}>
            {REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>

          <label>Time estimate</label>
          <div className="estimate">
            <input className="in" type="number" min="0" step="0.25" value={estimate} disabled={!canWrite} placeholder="0"
              onChange={(e) => setEstimate(e.target.value)} onBlur={saveEstimate} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} aria-label="Time estimate in hours" />
            <span className="muted">hours</span>
          </div>

          <label>Tags</label>
          <input className="in" value={tags} placeholder="design, launch" disabled={!canWrite}
            onChange={(e) => setTags(e.target.value)} onBlur={saveTags} />
        </div>

        <label>Description</label>
        <textarea className="in panel-desc" rows={6} value={desc} placeholder="Add details…" maxLength={5000} disabled={!canWrite}
          onChange={(e) => setDesc(e.target.value)} onBlur={saveDesc} />
        <Subtasks task={task} canWrite={canWrite} onReplace={onReplace} />
        <Dependencies task={task} tasks={tasks} canWrite={canWrite} onUpdate={onUpdate} />
        <Attachments task={task} canWrite={canWrite} />
        <TimeSection task={task} canWrite={canWrite} onReplace={onReplace} />
        <Recordings task={task} canWrite={canWrite} />
        <div className="muted panel-foot">Created {new Date(task.createdAt).toLocaleString()}</div>
        </div>
        <div className="modal-side">
          <Comments task={task} members={members} />
        </div>
        </div>
      </div>
    </>
  );
}

// Several people per task: chips with a remove button, plus a menu to add more
function AssigneePicker({ value, members, disabled, onChange }) {
  const chosen = value.map((id) => members.find((m) => m.userId === id)).filter(Boolean);
  const rest = members.filter((m) => !value.includes(m.userId));
  return (
    <div className="assignees">
      {chosen.map((m) => (
        <span key={m.userId} className="chip">
          <span className="av sm">{m.name[0]?.toUpperCase()}</span>{m.name}
          {!disabled && <button className="chip-x" aria-label={`Remove ${m.name}`} onClick={() => onChange(value.filter((id) => id !== m.userId))}><Icon name="x" size={12} /></button>}
        </span>
      ))}
      {!disabled && rest.length > 0 && (
        <select className="in chip-add" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label="Add assignee">
          <option value="">+ Add</option>
          {rest.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
      )}
      {chosen.length === 0 && disabled && <span className="muted">Unassigned</span>}
    </div>
  );
}

// ---------- Attachments ----------
function Attachments({ task, canWrite }) {
  const { user } = useAuth();
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const load = () => api.listAttachments(task._id).then((r) => setFiles(r.data)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [task._id]);

  const upload = async (list) => {
    setError('');
    setBusy(true);
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) { setError(`${f.name} is larger than 25 MB`); continue; }
      try { if (f.size > 4 * 1024 * 1024) await uploadBigFile(task._id, f); else await api.uploadAttachment(task._id, f); } catch (err) { setError(`${f.name}: ${err.message}`); }
    }
    setBusy(false);
    load();
  };

  const download = async (f) => {
    try {
      const blob = await api.attachmentBlob(f._id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name || 'file';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (f) => {
    if (!window.confirm(`Delete ${f.name}? This cannot be undone.`)) return;
    try { await api.deleteAttachment(f._id); load(); } catch (err) { setError(err.message); }
  };

  return (
    <section className="panel-sec"
      onDragOver={(e) => { if (canWrite) e.preventDefault(); }}
      onDrop={(e) => { if (!canWrite) return; e.preventDefault(); upload([...e.dataTransfer.files]); }}>
      <div className="sec-head"><b>Attachments</b>{files && <span className="muted">{files.length}</span>}</div>
      <div className="files">
        {files?.map((f) => (
          <div key={f._id} className="file">
            {f.contentType.startsWith('image/') ? <AttachmentThumb id={f._id} name={f.name} /> : <span className="file-ic"><Icon name="doc" size={22} /></span>}
            <div className="file-info">
              <button className="link-plain ellipsis" onClick={() => download(f)} title={`Download ${f.name}`}>{f.name}</button>
              <small className="muted">{(f.size / 1024).toFixed(0)} KB · {f.userName}</small>
            </div>
            {(String(f.user) === String(user.id) || ['owner', 'admin'].includes(user.role)) && (
              <button className="mini-btn dark" aria-label={`Delete ${f.name}`} onClick={() => remove(f)}><Icon name="x" size={14} /></button>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <>
          <input ref={input} type="file" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
          <button className="btn small" disabled={busy} onClick={() => input.current.click()}>
            <Icon name="plus" size={14} /> {busy ? 'Uploading…' : 'Add files'}
          </button>
          <span className="muted small-note"> or drop files here (up to 25 MB each)</span>
        </>
      )}
      {error && <div className="err">{error}</div>}
    </section>
  );
}

// Large files go to Google Drive in pieces (see the server's /attachments/session route)
async function uploadBigFile(taskId, file) {
  const s = await api.attachmentSession(taskId, file.name, file.size);
  if (s.local) return api.uploadAttachment(taskId, file);
  const PIECE = 256 * 1024 * 12;
  for (let start = 0; start < file.size; start += PIECE) {
    const end = Math.min(start + PIECE, file.size);
    const res = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` }, body: file.slice(start, end) });
    if (!res.ok && res.status !== 308) throw new Error(`Upload failed (${res.status})`);
  }
  return api.attachmentFinish(taskId, { rel: s.rel, name: file.name, size: file.size });
}

function AttachmentThumb({ id, name }) {
  const url = useBlobUrl(api.attachmentBlob, id);
  return url ? <img className="file-thumb" src={url} alt={name} /> : <span className="file-ic muted">…</span>;
}

// ---------- Subtasks: a checklist inside the task ----------
function Subtasks({ task, canWrite, onReplace }) {
  const [error, setError] = useState('');
  const subs = task.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const run = async (fn) => {
    setError('');
    try { onReplace((await fn()).data); } catch (err) { setError(err.message); }
  };
  return (
    <section className="panel-sec">
      <div className="sec-head">
        <b>Subtasks</b>
        {subs.length > 0 && <span className="muted">{done}/{subs.length}</span>}
        {subs.length > 0 && <div className="bar sub-bar"><i style={{ width: `${(done / subs.length) * 100}%` }} /></div>}
      </div>
      {subs.map((s) => (
        <div key={s._id} className="sub-row">
          <input type="checkbox" checked={s.done} disabled={!canWrite} aria-label={`Mark ${s.name} done`}
            onChange={() => run(() => api.updateSubtask(task._id, s._id, { done: !s.done }))} />
          <span className={`grow ${s.done ? 'struck' : ''}`}>{s.name}</span>
          {canWrite && <button className="mini-btn dark" aria-label={`Delete subtask ${s.name}`} onClick={() => run(() => api.deleteSubtask(task._id, s._id))}>✕</button>}
        </div>
      ))}
      {canWrite && <QuickAdd placeholder="+ Add subtask" onAdd={(name) => run(() => api.addSubtask(task._id, name))} />}
      {error && <div className="err">{error}</div>}
    </section>
  );
}

// ---------- Comments ----------
function Comments({ task, members = [] }) {
  const { user } = useAuth();
  const canComment = ['owner', 'admin', 'member', 'guest'].includes(user.role);
  const [comments, setComments] = useState(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listComments(task._id).then((r) => setComments(r.data)).catch((err) => { setComments([]); setError(err.message); });
  }, [task._id]);

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError('');
    setBody('');
    try {
      const res = await api.addComment(task._id, text);
      setComments((cs) => [...cs, res.data]);
    } catch (err) {
      setError(err.message);
      setBody((b) => b || text); // give the text back so it is not lost
    }
  };

  const remove = async (c) => {
    setError('');
    try {
      await api.deleteComment(task._id, c._id);
      setComments((cs) => cs.filter((x) => x._id !== c._id));
    } catch (err) {
      setError(err.message);
    }
  };

  const mine = (c) => String(c.author) === String(user.id || user._id);
  const isAdmin = ['owner', 'admin'].includes(user.role);

  return (
    <section className="panel-sec">
      <div className="sec-head"><b>Comments</b>{comments && <span className="muted">{comments.length}</span>}</div>
      {comments === null && <div className="muted">Loading…</div>}
      {comments?.length === 0 && <div className="muted small-note">No comments yet.</div>}
      {comments?.map((c) => (
        <div key={c._id} className="comment">
          <span className="av">{c.authorName?.[0]?.toUpperCase()}</span>
          <div className="grow">
            <div className="comment-meta"><b>{c.authorName}</b> <span className="muted">{timeAgo(c.createdAt)}</span>
              {(mine(c) || isAdmin) && <button className="link-btn" onClick={() => remove(c)}>Delete</button>}
            </div>
            <div className="comment-body">{c.body}</div>
          </div>
        </div>
      ))}
      {canComment && (
        <form className="comment-form" onSubmit={send}>
          <textarea className="in" rows={2} placeholder={members.length > 1 ? `Write a comment… Type @${members.find((m) => m.userId !== String(user.id))?.name || "name"} to mention` : "Write a comment… (Ctrl+Enter to send)"} value={body} maxLength={4000}
            onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }} />
          <button className="btn primary small" disabled={!body.trim()}>Comment</button>
        </form>
      )}
      {error && <div className="err">{error}</div>}
    </section>
  );
}

export function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SubCount({ task }) {
  const subs = task.subtasks || [];
  if (!subs.length) return null;
  const done = subs.filter((s) => s.done).length;
  return <span className={`sub-count ${done === subs.length ? 'all' : ''}`} title="Subtasks done">☑ {done}/{subs.length}</span>;
}

// ---------- Time tracking: timer, entries with activity counts and screenshots ----------
function TimeSection({ task, canWrite, onReplace }) {
  const { user } = useAuth();
  const tracker = useTracker();
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(task.timeSpent || 0);
  const [withShots, setWithShots] = useState(() => localStorage.getItem('nexus.withShots') === '1');
  const [viewing, setViewing] = useState(null); // screenshot id shown large
  const [error, setError] = useState('');
  const mine = tracker.running && tracker.running.task === task._id;
  const now = useNow(!!mine);

  const load = () => api.taskTime(task._id).then((r) => { setEntries(r.data); setTotal(r.timeSpent); }).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [task._id]);
  useEffect(() => {
    const onChange = (e) => { if (!e.detail?.taskId || e.detail.taskId === task._id) load(); };
    window.addEventListener('nexus:time-changed', onChange);
    return () => window.removeEventListener('nexus:time-changed', onChange);
  }, [task._id]);

  const toggleShots = (v) => { setWithShots(v); localStorage.setItem('nexus.withShots', v ? '1' : '0'); };
  const runningSecs = mine ? (now - new Date(tracker.running.start)) / 1000 : 0;

  const removeEntry = async (e) => {
    if (!window.confirm('Delete this time entry and its screenshots? This cannot be undone.')) return;
    try {
      const res = await api.deleteTimeEntry(e._id);
      if (res.task) onReplace(res.task);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="panel-sec">
      <div className="sec-head">
        <b>Time tracked</b>
        <span className="time-total">{fmtHours(total + runningSecs)}</span>
      </div>
      {canWrite && (
        <div className="timer-row">
          {mine ? (
            <button className="btn stop-timer" onClick={tracker.stop}>■ Stop · {fmtDuration(runningSecs)}</button>
          ) : (
            <button className="btn primary" onClick={() => tracker.start(task, withShots)}>▶ Start timer</button>
          )}
          {!mine && (
            <label className="check-row shots-check">
              <input type="checkbox" checked={withShots} onChange={(e) => toggleShots(e.target.checked)} />
              Take screenshots every 5–10 min
            </label>
          )}
          {mine && (
            <span className="muted live-stats">
              ⌨ {tracker.live.keys} keys · 🖱 {tracker.live.clicks} clicks{tracker.shotsOn ? ` · 📸 ${tracker.shotCount}` : ''}
            </span>
          )}
        </div>
      )}
      {!mine && withShots && canWrite && (
        <div className="muted consent-note">
          {tracker.desktop
            ? 'The Nexus Tracker app takes a screenshot of your main screen every 5–10 minutes while this timer runs and counts key presses and clicks across this computer (never which keys). '
            : 'Your browser will ask which screen to share. Screenshots are only taken while this timer runs, and key presses and clicks are counted inside Nexus only (never which keys). '}
          You can see every screenshot below, and only you and workspace admins can view them.
        </div>
      )}

      {entries?.length > 0 && (
        <div className="entries">
          {entries.map((e) => (
            <div key={e._id} className="entry">
              <div className="entry-top">
                <span className="av">{e.userName?.[0]?.toUpperCase()}</span>
                <b>{e.userName}</b>
                <span className="muted">
                  {new Date(e.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <div className="grow" />
                <span className="entry-dur">{e.end ? fmtHours(e.seconds) : 'running'}</span>
                {(String(e.user) === String(user.id) || ['owner', 'admin'].includes(user.role)) && e.end && (
                  <button className="mini-btn dark" aria-label="Delete time entry" onClick={() => removeEntry(e)}>✕</button>
                )}
              </div>
              <div className="entry-stats muted">
                ⌨ {e.keystrokes} keys · 🖱 {e.clicks} clicks{e.screenshots ? ` · 📸 ${e.shots.length + e.hiddenShots}` : ''}
              </div>
              {e.shots.length > 0 && (
                <div className="shots">
                  {e.shots.map((s) => <Shot key={s._id} id={s._id} takenAt={s.takenAt} onOpen={() => setViewing(s._id)} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {entries?.length === 0 && <div className="muted small-note">No time tracked yet.</div>}
      {error && <div className="err">{error}</div>}
      {viewing && <ShotViewer id={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

// Images and videos need the login token, so they are fetched as blobs
function useBlobUrl(fetcher, id) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    let alive = true;
    fetcher(id)
      .then((b) => { if (alive) { u = URL.createObjectURL(b); setUrl(u); } })
      .catch(() => alive && setUrl(''));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url;
}

export function Shot({ id, takenAt, onOpen }) {
  const url = useBlobUrl(api.screenshotBlob, id);
  const time = new Date(takenAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <button className="shot" onClick={onOpen} title={new Date(takenAt).toLocaleString()}>
      {url ? <img src={url} alt={`Screenshot at ${time}`} /> : <span className="muted">…</span>}
      <small>{time}</small>
    </button>
  );
}

export function ShotViewer({ id, onClose }) {
  const url = useBlobUrl(api.screenshotBlob, id);
  // Escape closes only the picture, not the task
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="shot-viewer" onClick={onClose}>
      {url ? <img src={url} alt="Screenshot" /> : <span className="muted">Loading…</span>}
      <button className="icon-btn shot-close" aria-label="Close screenshot">✕</button>
    </div>
  );
}

// ---------- Screen recordings ----------
function Recordings({ task, canWrite }) {
  const { user } = useAuth();
  const tracker = useTracker();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const recordingThis = tracker.recording?.taskId === task._id;

  const load = () => api.listRecordings(task._id).then((r) => setList(r.data)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [task._id]);
  useEffect(() => {
    const onChange = (e) => { if (e.detail?.taskId === task._id) load(); };
    window.addEventListener('nexus:recordings-changed', onChange);
    return () => window.removeEventListener('nexus:recordings-changed', onChange);
  }, [task._id]);

  const remove = async (r) => {
    if (!window.confirm('Delete this recording? This cannot be undone.')) return;
    try { await api.deleteRecording(r._id); load(); } catch (err) { setError(err.message); }
  };

  return (
    <section className="panel-sec">
      <div className="sec-head"><b>Screen recordings</b>{list && <span className="muted">{list.length}</span>}</div>
      {canWrite && (recordingThis ? (
        <button className="btn stop-timer" onClick={tracker.stopRecording}>■ Stop recording</button>
      ) : (
        <button className="btn" disabled={!!tracker.recording || tracker.uploading} onClick={() => tracker.startRecording(task)}>
          ⏺ Record screen
        </button>
      ))}
      {tracker.uploading && <span className="muted"> Uploading…</span>}
      {list?.map((r) => (
        <div key={r._id} className="recording">
          <RecordingPlayer id={r._id} />
          <div className="entry-stats muted">
            {r.userName} · {new Date(r.createdAt).toLocaleString()} · {fmtDuration(r.seconds)} · {(r.size / 1048576).toFixed(1)} MB
            {(String(r.user) === String(user.id) || ['owner', 'admin'].includes(user.role)) && (
              <button className="link-btn" onClick={() => remove(r)}>Delete</button>
            )}
          </div>
        </div>
      ))}
      {error && <div className="err">{error}</div>}
    </section>
  );
}

// The video downloads only when asked, since recordings can be large
function RecordingPlayer({ id }) {
  const [show, setShow] = useState(false);
  return show ? <LoadedVideo id={id} /> : <button className="btn small" onClick={() => setShow(true)}>▶ Play recording</button>;
}

function LoadedVideo({ id }) {
  const url = useBlobUrl(api.recordingBlob, id);
  if (url === null) return <div className="muted">Loading video…</div>;
  if (!url) return <div className="err">Could not load the video.</div>;
  return <video className="rec-video" src={url} controls />;
}

function TimeBadge({ task }) {
  const tracker = useTracker();
  const running = tracker?.running?.task === task._id;
  if (!task.timeSpent && !running) return null;
  return <span className={`time-badge ${running ? 'live' : ''}`} title="Time tracked">⏱ {running ? 'live' : fmtHours(task.timeSpent)}</span>;
}

// ---------- small pieces ----------
function QuickAdd({ placeholder, onAdd, autoFocus, onCancel }) {
  const [value, setValue] = useState('');
  return (
    <form className="quick-add" onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (v) { onAdd(v); setValue(''); } }}>
      <input placeholder={placeholder} value={value} maxLength={200} autoFocus={autoFocus} aria-label="New task name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }}
        onBlur={() => { if (!value.trim()) onCancel?.(); }} />
    </form>
  );
}

// Up to three faces, then "+N"
function AvatarStack({ users }) {
  if (!users.length) return <span className="av empty" title="Unassigned"><Icon name="users" size={13} /></span>;
  return (
    <span className="av-stack" title={users.map((u) => u.name).join(', ')}>
      {users.slice(0, 3).map((u) => <span key={u.userId} className="av">{u.name?.[0]?.toUpperCase()}</span>)}
      {users.length > 3 && <span className="av more">+{users.length - 3}</span>}
    </span>
  );
}

function PriorityFlag({ id }) {
  const p = PRIORITIES.find((x) => x.id === id);
  if (!p) return <span className="muted flag-none">—</span>;
  return <span className="flag" style={{ color: p.color }} title={`${p.label} priority`}>⚑ <span className="flag-label">{p.label}</span></span>;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dueClass(t) {
  if (!t.dueDate || t.closed) return 'due';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(t.dueDate) < today ? 'due overdue' : 'due';
}
