import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { SECTIONS } from '../sections.js';
import Icon from './Icon.jsx';

const STATUS = { todo: 'To Do', prog: 'In Progress', done: 'Done' };

// Top-bar search across tasks, lists, docs and other items, and chat messages.
// `onPick` gets { page, taskId?, channelId? }.
export default function SearchBox({ value, onChange, onPick }) {
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // Ctrl+K (Cmd+K on Mac) jumps to search from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Search 250 ms after typing stops; ignore answers to older queries
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setResults(null); return; }
    let stale = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q)
        .then((r) => !stale && setResults(r.data))
        .catch(() => !stale && setResults({ tasks: [], lists: [], items: [], messages: [] }))
        .finally(() => !stale && setLoading(false));
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [value]);

  // Close when clicking elsewhere
  useEffect(() => {
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (target) => { setOpen(false); onChange(''); onPick(target); };
  const sectionFor = (kind) => SECTIONS.find((s) => s.kind === kind);
  const total = results ? results.tasks.length + results.lists.length + results.items.length + results.messages.length : 0;

  return (
    <div className="search" ref={boxRef}>
      <Icon name="search" size={16} />
      <input ref={inputRef} placeholder="Search tasks, docs, messages…" value={value} aria-label="Search"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); } }} />
      <kbd className="kbd">Ctrl K</kbd>
      {open && value.trim().length >= 2 && (
        <div className="search-pop" role="listbox">
          {loading && !results && <div className="sr-empty muted">Searching…</div>}
          {results && total === 0 && !loading && <div className="sr-empty muted">No results for “{value.trim()}”</div>}

          {results?.tasks.length > 0 && <div className="sr-grp">Tasks</div>}
          {results?.tasks.map((t) => (
            <button key={t._id} className="sr-item" disabled={!t.list}
              title={t.list ? '' : 'This task is not in a list; find it in My Work'}
              onClick={() => pick(t.list ? { page: `list:${t.list}`, taskId: t._id } : { page: 'mywork' })}>
              <span className="sr-ic"><Icon name="check" size={16} /></span><span className="ellipsis grow">{t.name}</span><small className="muted">{STATUS[t.status] || (t.closed ? 'Done' : 'Open')}</small>
            </button>
          ))}

          {results?.lists.length > 0 && <div className="sr-grp">Lists</div>}
          {results?.lists.map((l) => (
            <button key={l._id} className="sr-item" onClick={() => pick({ page: `list:${l._id}` })}>
              <span className="sr-ic"><Icon name="list" size={16} /></span><span className="ellipsis grow">{l.name}</span><small className="muted">{l.spaceName}</small>
            </button>
          ))}

          {results?.items.length > 0 && <div className="sr-grp">Docs and more</div>}
          {results?.items.map((it) => {
            const s = sectionFor(it.kind);
            return (
              <button key={it._id} className="sr-item" disabled={!s} onClick={() => s && pick({ page: s.id })}>
                <span className="sr-ic"><Icon name={s?.icon || 'dots'} size={16} /></span><span className="ellipsis grow">{it.name}</span><small className="muted">{s?.label || it.kind}</small>
              </button>
            );
          })}

          {results?.messages.length > 0 && <div className="sr-grp">Messages</div>}
          {results?.messages.map((m) => (
            <button key={m._id} className="sr-item" onClick={() => pick({ page: 'chat', channelId: m.channel })}>
              <span className="sr-ic"><Icon name="chat" size={16} /></span><span className="ellipsis grow">{m.body}</span><small className="muted">{m.channelName}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
