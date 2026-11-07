import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormBuilder from '../components/FormBuilder.jsx';
import RichEditor from '../components/RichEditor.jsx';
import Whiteboard from '../components/Whiteboard.jsx';
import Dashboard from '../components/Dashboard.jsx';

// Kinds whose rows open an editor panel below the table
const OPENABLE = ['form', 'doc', 'whiteboard'];

// Generic list + create + edit + delete page for any section defined in sections.js.
// Adds section-specific views: Goals progress, Timesheet total, Chat auto-refresh, Forms builder.
export default function Section({ section }) {
  const { user } = useAuth();
  const canWrite = ['owner', 'admin', 'member'].includes(user.role);
  const canChat = canWrite || user.role === 'guest';
  const [items, setItems] = useState([]);
  const [all, setAll] = useState([]); // used for totals (timesheets, form responses)
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [name, setName] = useState('');
  const [extra, setExtra] = useState({});
  const [editing, setEditing] = useState(null);
  const [openForm, setOpenForm] = useState(null);
  const [error, setError] = useState('');

  const load = async (p = page) => {
    try {
      const res = await api.listItems(section.kind, p, 20);
      setItems(res.data);
      setMeta(res.meta);
      if (section.id === 'timesheets' || section.id === 'forms') {
        const every = await api.listItems(section.kind, 1, 100);
        setAll(every.data);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // reset form state when the section changes (the parent also remounts via key)
  useEffect(() => {
    setPage(1); setName(''); setExtra({}); setEditing(null); setOpenForm(null); setError('');
  }, [section.id]);

  useEffect(() => { load(page); }, [section.id, page]);

  // Chat: refresh every 5 seconds so new messages appear
  useEffect(() => {
    if (section.id !== 'chat') return;
    const t = setInterval(() => load(1), 5000);
    return () => clearInterval(t);
  }, [section.id]);

  const fieldValue = (f) => extra[f.key] ?? f.default ?? '';

  const reset = () => { setName(''); setExtra({}); setEditing(null); };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    const data = {};
    section.extra.forEach((f) => {
      const v = fieldValue(f);
      data[f.key] = f.type === 'number' ? Number(v) || 0 : v;
    });
    try {
      if (editing) await api.updateItem(editing._id, { name: name.trim(), data });
      else await api.createItem({ kind: section.kind, name: name.trim(), data });
      reset();
      setError('');
      setPage(1);
      load(1);
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (it) => {
    setEditing(it);
    setName(it.name);
    const e = {};
    section.extra.forEach((f) => { e[f.key] = it.data?.[f.key] ?? ''; });
    setExtra(e);
  };

  const remove = async (item) => {
    try {
      await api.deleteItem(item._id);
      if (editing?._id === item._id) reset();
      load(page);
    } catch (err) {
      setError(err.message);
    }
  };

  const updateProgress = async (item, value) => {
    try {
      await api.updateItem(item._id, { data: { ...item.data, progress: Number(value) } });
      load(page);
    } catch (err) {
      setError(err.message);
    }
  };

  const totalHours = all.reduce((sum, it) => sum + (Number(it.data?.hours) || 0), 0);
  const responses = (formId) => all.filter((r) => r.data?.formId === formId).length;

  return (
    <>
      {(canWrite || (section.kind === 'message' && canChat)) && (
      <form className="stack-form" onSubmit={save}>
        <input className="in" placeholder={`${section.createLabel} — name`} value={name} onChange={(e) => setName(e.target.value)} />
        {section.extra.map((f) => {
          const value = editing ? (extra[f.key] ?? '') : fieldValue(f);
          const onChange = (e) => setExtra({ ...extra, [f.key]: e.target.value });
          if (f.type === 'select') {
            return (
              <select key={f.key} className="in" value={value || f.default} onChange={onChange}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
          }
          if (f.multiline) {
            return <textarea key={f.key} className="in" rows={3} placeholder={f.label} value={value} onChange={onChange} />;
          }
          return <input key={f.key} className="in" type={f.type || 'text'} placeholder={f.label} value={value} onChange={onChange} />;
        })}
        <div className="row">
          <button className="btn primary" type="submit">{editing ? 'Save changes' : section.createLabel}</button>
          {editing && <button className="btn" type="button" onClick={reset}>Cancel edit</button>}
        </div>
      </form>
      )}
      <div className="err">{error}</div>

      {section.kind === 'dashboard' && <Dashboard />}

      {section.id === 'timesheets' && (
        <div className="card"><b>Total logged:</b> {totalHours} hours across {all.length} entries</div>
      )}

      {items.length === 0 && <div className="card muted">Nothing here yet. Add the first item above.</div>}

      {items.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Details</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it._id}>
                <td>{it.name}</td>
                <td className="muted">
                  {section.id === 'goals' ? (
                    <div className="progress-cell">
                      <div className="bar"><i style={{ width: `${Math.min(Number(it.data?.progress) || 0, 100)}%` }} /></div>
                      <input type="number" min="0" max="100" className="in small-in" defaultValue={Number(it.data?.progress) || 0}
                        onBlur={(e) => updateProgress(it, e.target.value)} /> %
                    </div>
                  ) : section.id === 'forms' ? (
                    <>{(it.data?.fields || []).length} fields · {responses(it._id)} responses</>
                  ) : summary(it.data)}
                </td>
                <td className="muted">{new Date(it.createdAt).toLocaleDateString()}</td>
                <td className="actions">
                  {OPENABLE.includes(section.kind) && <button className="btn small" onClick={() => setOpenForm(openForm === it._id ? null : it._id)}>{openForm === it._id ? 'Close' : 'Open'}</button>}
                  {canWrite && <button className="btn small" onClick={() => startEdit(it)}>Edit</button>}
                  {canWrite && <button className="btn small" onClick={() => remove(it)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {section.kind === 'form' && openForm && items.find((i) => i._id === openForm) && (
        <FormBuilder
          item={items.find((i) => i._id === openForm)}
          onChanged={() => load(page)}
          onError={setError}
        />
      )}

      {section.kind === 'doc' && openForm && items.find((i) => i._id === openForm) && (
        <RichEditor
          item={items.find((i) => i._id === openForm)}
          onSaved={() => load(page)}
          onError={setError}
        />
      )}

      {section.kind === 'whiteboard' && openForm && items.find((i) => i._id === openForm) && (
        <Whiteboard
          item={items.find((i) => i._id === openForm)}
          onSaved={() => load(page)}
          onError={setError}
        />
      )}

      {meta.pages > 1 && (
        <div className="row pager">
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {meta.page} of {meta.pages}</span>
          <button className="btn small" disabled={page >= meta.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}

// One-line summary of an item's extra fields
function summary(data = {}) {
  return Object.entries(data)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
    .join(' · ');
}
