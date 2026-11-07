import { useState } from 'react';
import { api } from '../api.js';

// Builds a form (fields saved on the form item) and lets you fill it in.
// Each submission is saved as a `formResponse` item linked by formId.
const TYPES = ['text', 'number', 'select'];

export default function FormBuilder({ item, onChanged, onError }) {
  const fields = item.data?.fields || [];
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);

  const saveFields = async (next) => {
    try {
      await api.updateItem(item._id, { data: { ...item.data, fields: next } });
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  };

  const addField = (e) => {
    e.preventDefault();
    if (!label.trim()) return onError('Field label is required');
    const f = { id: Date.now().toString(36), label: label.trim(), type };
    if (type === 'select') f.options = options.split(',').map((o) => o.trim()).filter(Boolean);
    setLabel(''); setOptions(''); setType('text');
    saveFields([...fields, f]);
  };

  const removeField = (id) => saveFields(fields.filter((f) => f.id !== id));

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.createItem({
        kind: 'formResponse',
        name: `Response to ${item.name}`,
        data: { formId: item._id, answers },
      });
      setAnswers({});
      setDone(true);
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div className="card form-builder">
      <h3>{item.name}</h3>

      <div className="section-title">Fields</div>
      {fields.length === 0 && <div className="muted">No fields yet. Add one below.</div>}
      <ul className="field-list">
        {fields.map((f) => (
          <li key={f.id}>
            <b>{f.label}</b> <span className="muted">({f.type}{f.options ? `: ${f.options.join(', ')}` : ''})</span>
            <button className="btn small" onClick={() => removeField(f.id)}>Remove</button>
          </li>
        ))}
      </ul>

      <form className="row wrap" onSubmit={addField}>
        <input className="in" placeholder="Field label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className="in" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {type === 'select' && (
          <input className="in" placeholder="Options, comma separated" value={options} onChange={(e) => setOptions(e.target.value)} />
        )}
        <button className="btn" type="submit">Add field</button>
      </form>

      <div className="section-title">Preview / fill in</div>
      {fields.length === 0 ? (
        <div className="muted">Add fields first.</div>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          {fields.map((f) => (
            <div key={f.id}>
              <label>{f.label}</label>
              {f.type === 'select' ? (
                <select className="in" value={answers[f.id] || ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })}>
                  <option value="">Choose…</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="in" type={f.type} value={answers[f.id] || ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="row">
            <button className="btn primary" type="submit">Submit response</button>
            {done && <span className="ok">Saved</span>}
          </div>
        </form>
      )}
    </div>
  );
}
