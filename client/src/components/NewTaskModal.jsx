import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { statusesOf, PRIORITIES } from './ListView.jsx';

const LAST_LIST = 'nexus.lastList';

// Centered "Create task" dialog opened from the top bar. On success it calls onCreated(task).
export default function NewTaskModal({ spaces, members, defaultListId, onClose, onCreated, onNeedList }) {
  const lists = spaces.flatMap((s) => s.lists.map((l) => ({ ...l, spaceName: s.name })));
  const initialList = [defaultListId, localStorage.getItem(LAST_LIST)].find((id) => id && lists.some((l) => l._id === id)) || lists[0]?._id || '';
  const [name, setName] = useState('');
  const [list, setList] = useState(initialList);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Task name is required');
    if (!list) return setError('Pick a list');
    setSaving(true);
    setError('');
    try {
      const res = await api.createTask({ name: name.trim(), list, ...(status ? { status } : {}), priority: priority || null, assignees: assignee ? [assignee] : [] });
      localStorage.setItem(LAST_LIST, list);
      onCreated(res.data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <form className="task-modal new-task" role="dialog" aria-modal="true" aria-label="Create task" onSubmit={submit}>
        <div className="panel-top">
          <b>Create task</b>
          <div className="grow" />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {lists.length === 0 ? (
          <div className="card muted">
            Tasks live in lists. Create a space and a list first.{' '}
            <span className="link" onClick={onNeedList}>Create one</span>
          </div>
        ) : (
          <>
            <input autoFocus className="panel-name" placeholder="Task name" value={name} maxLength={200}
              onChange={(e) => setName(e.target.value)} aria-label="Task name" />
            <div className="fields">
              <label>List</label>
              <select className="in" value={list} onChange={(e) => { setList(e.target.value); setStatus(''); }}>
                {spaces.map((s) => s.lists.length > 0 && (
                  <optgroup key={s._id} label={s.name}>
                    {s.lists.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <label>Status</label>
              <select className="in" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{statusesOf(lists.find((l) => l._id === list))[0].name} (first)</option>
                {statusesOf(lists.find((l) => l._id === list)).slice(1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label>Assignee</label>
              <select className="in" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>
              <label>Priority</label>
              <select className="in" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">No priority</option>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            {error && <div className="err server">{error}</div>}
            <div className="row modal-actions">
              <div className="grow" />
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={saving}>{saving ? 'Creating…' : 'Create task'}</button>
            </div>
          </>
        )}
      </form>
    </>
  );
}
