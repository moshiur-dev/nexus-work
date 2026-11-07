import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SECTIONS } from '../sections.js';

// Dashboard: counts of items per section, drawn as horizontal bars.
// Uses the list endpoint's meta.total, so each section needs only one request.
export default function Dashboard() {
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all(
      SECTIONS.map((s) => api.listItems(s.kind, 1, 1).then((r) => [s.label, r.meta.total]))
    )
      .then((rows) => setCounts(rows))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="err">{error}</div>;
  if (!counts) return <div className="muted">Loading…</div>;

  const max = Math.max(1, ...counts.map(([, n]) => n));
  const total = counts.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="card">
      <div className="muted">{total} items across {counts.length} sections</div>
      {counts.map(([label, n]) => (
        <div key={label} className="bar-row">
          <span className="bar-label">{label}</span>
          <div className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></div>
          <span className="bar-value">{n}</span>
        </div>
      ))}
    </div>
  );
}
