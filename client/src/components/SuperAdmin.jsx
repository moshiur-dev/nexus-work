import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Shown only to the super admin. Values are typed here and saved encrypted on the server; they are never shown again.
export default function SuperAdmin() {
  const [rows, setRows] = useState(null);
  const [canSave, setCanSave] = useState(true);
  const [error, setError] = useState('');

  const load = () => api.adminSettings()
    .then((r) => { setRows(r.data); setCanSave(r.canSave); })
    .catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  return (
    <section className="card super-admin">
      <div className="sa-head">
        <b>Super admin: server settings</b>
        <span className="muted">Saved on the server, not shown again after saving.</span>
      </div>
      {!canSave && <div className="err">The server has no ENCRYPTION_KEY yet, so settings cannot be saved. Add it in the server environment first.</div>}
      {rows === null && !error && <div className="muted">Loading…</div>}
      {rows?.map((r) => <SettingRow key={r.key} row={r} disabled={!canSave} onSaved={setRows} />)}
      {error && <div className="err">{error}</div>}
    </section>
  );
}

function SettingRow({ row, disabled, onSaved }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = async (v) => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await api.adminSetSetting(row.key, v);
      onSaved(res.data);
      setValue('');
      setMsg(v === '' ? 'Cleared' : 'Saved');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const sourceText = { saved: 'Saved', environment: 'From server environment', 'not set': 'Not set' }[row.source];

  return (
    <div className="sa-row">
      <div className="sa-label">
        <b>{row.label}</b>
        <small className={`sa-source ${row.source}`}>{sourceText}{row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleDateString()}` : ''}</small>
      </div>
      <div className="sa-input">
        <input
          className="in"
          type={row.secret ? 'password' : 'text'}
          autoComplete="off"
          placeholder={row.source === 'saved' ? 'Saved — type to replace' : 'Type a value'}
          value={value}
          disabled={disabled || busy}
          onChange={(e) => setValue(e.target.value)}
          aria-label={row.label}
        />
        <button className="btn primary small" disabled={disabled || busy || !value.trim()} onClick={() => save(value.trim())}>Save</button>
        {row.source === 'saved' && <button className="btn small" disabled={disabled || busy} onClick={() => save('')}>Clear</button>}
      </div>
      {msg && <span className="ok sa-msg">{msg}</span>}
      {err && <span className="err sa-msg">{err}</span>}
    </div>
  );
}
