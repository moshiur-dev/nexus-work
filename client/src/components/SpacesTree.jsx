import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const COLORS = ['#7b68ee', '#22c3d6', '#f59e0b', '#ef4444', '#10b981', '#ec4899', '#3b82f6', '#64748b'];

// Sidebar tree: Spaces > Folders > Lists (lists can also sit straight in a space).
// Selecting a list calls onOpen(`list:<id>`). After a change the whole tree reloads from the server.
export default function SpacesTree({ spaces, reload, active, onOpen, canWrite }) {
  const [collapsed, setCollapsed] = useState({}); // space or folder id -> true when closed
  const [adding, setAdding] = useState(null); // { kind: 'space' } | { kind: 'list'|'folder', space, folder? }
  const [menu, setMenu] = useState(null); // id of the space or folder whose menu is open
  const [renaming, setRenaming] = useState(null); // { kind, id }
  const [error, setError] = useState('');

  const run = async (fn) => {
    setError('');
    try { await fn(); await reload(); } catch (err) { setError(err.message); }
  };
  const toggle = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const open = (id) => setCollapsed((c) => ({ ...c, [id]: false }));

  const addSpace = (name) => run(async () => {
    const res = await api.createSpace({ name, color: COLORS[spaces.length % COLORS.length] });
    setAdding({ kind: 'list', space: res.data._id }); // go straight to adding its first list
  });
  const addFolder = (spaceId, name) => run(async () => {
    const res = await api.createFolder({ name, space: spaceId });
    open(spaceId);
    setAdding({ kind: 'list', space: spaceId, folder: res.data._id });
  });
  const addList = (spaceId, folderId, name) => run(async () => {
    const res = await api.createList({ name, space: spaceId, folder: folderId || null });
    setAdding(null);
    open(spaceId);
    if (folderId) open(folderId);
    onOpen(`list:${res.data._id}`);
  });
  const rename = (kind, id, name) => run(async () => {
    if (kind === 'space') await api.updateSpace(id, { name });
    if (kind === 'folder') await api.updateFolder(id, { name });
    setRenaming(null);
  });
  const removeSpace = (space) => run(async () => {
    const n = space.lists.reduce((sum, l) => sum + l.total, 0);
    if (!window.confirm(`Delete space "${space.name}" with ${space.lists.length} list(s) and ${n} task(s)? This cannot be undone.`)) return;
    await api.deleteSpace(space._id);
    if (space.lists.some((l) => active === `list:${l._id}`)) onOpen('home');
  });
  const removeFolder = (folder) => run(async () => {
    if (!window.confirm(`Delete folder "${folder.name}"? Its lists stay and move up to the space.`)) return;
    await api.deleteFolder(folder._id);
  });
  const moveList = (list, folderId) => run(async () => { await api.updateList(list._id, { folder: folderId }); });

  const listRow = (l, s) => (
    <div key={l._id} className={`nav list-row ${active === `list:${l._id}` ? 'on' : ''}`} onClick={() => onOpen(`list:${l._id}`)}>
      <span className="list-dot"><Icon name="list" size={15} /></span>
      <span className="grow ellipsis">{l.name}</span>
      {l.open > 0 && <span className="count">{l.open}</span>}
      {canWrite && (s.folders || []).length > 0 && (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <select className="move-select" value={l.folder || ''} title="Move to folder" aria-label={`Move ${l.name} to folder`}
            onChange={(e) => moveList(l, e.target.value || null)}>
            <option value="">No folder</option>
            {s.folders.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
          </select>
        </span>
      )}
    </div>
  );

  const addingHere = (kind, space, folder = null) => adding?.kind === kind && adding.space === space && (adding.folder || null) === folder;

  return (
    <>
      <div className="grp grp-row">
        <span>Spaces</span>
        {canWrite && <button className="mini-btn" title="New space" aria-label="New space" onClick={() => setAdding({ kind: 'space' })}><Icon name="plus" size={14} /></button>}
      </div>

      {spaces.length === 0 && adding?.kind !== 'space' && (
        <div className="tree-empty">
          No spaces yet.{' '}
          {canWrite && <span className="link" onClick={() => setAdding({ kind: 'space' })}>Create one</span>}
        </div>
      )}

      {spaces.map((s) => {
        const folders = s.folders || [];
        const loose = s.lists.filter((l) => !l.folder || !folders.some((f) => f._id === l.folder));
        return (
          <div key={s._id} className="tree-space">
            {renaming?.id === s._id ? (
              <InlineInput initial={s.name} placeholder="Space name" onSubmit={(v) => rename('space', s._id, v)} onCancel={() => setRenaming(null)} />
            ) : (
              <div className="nav space-row" onClick={() => toggle(s._id)}>
                <span className={`caret ${collapsed[s._id] ? 'shut' : ''}`}><Icon name="chevron" size={12} /></span>
                <span className="space-badge" style={{ background: s.color }}>{s.name[0]?.toUpperCase()}</span>
                <span className="grow ellipsis">{s.name}</span>
                {canWrite && (
                  <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="mini-btn" title="New list" aria-label={`New list in ${s.name}`} onClick={() => { open(s._id); setAdding({ kind: 'list', space: s._id }); }}><Icon name="plus" size={14} /></button>
                    <button className="mini-btn" title="More" aria-label={`More actions for ${s.name}`} onClick={() => setMenu(menu === s._id ? null : s._id)}><Icon name="dots" size={14} /></button>
                  </span>
                )}
              </div>
            )}

            {menu === s._id && (
              <div className="tree-menu" onMouseLeave={() => setMenu(null)}>
                <button onClick={() => { setMenu(null); open(s._id); setAdding({ kind: 'list', space: s._id }); }}>New list</button>
                <button onClick={() => { setMenu(null); open(s._id); setAdding({ kind: 'folder', space: s._id }); }}>New folder</button>
                <button onClick={() => { setMenu(null); setRenaming({ kind: 'space', id: s._id }); }}>Rename</button>
                <button className="danger" onClick={() => { setMenu(null); removeSpace(s); }}>Delete space</button>
              </div>
            )}

            {!collapsed[s._id] && (
              <div className="tree-lists">
                {folders.map((f) => {
                  const lists = s.lists.filter((l) => l.folder === f._id);
                  return (
                    <div key={f._id} className="tree-folder">
                      {renaming?.id === f._id ? (
                        <InlineInput initial={f.name} placeholder="Folder name" onSubmit={(v) => rename('folder', f._id, v)} onCancel={() => setRenaming(null)} />
                      ) : (
                        <div className="nav folder-row" onClick={() => toggle(f._id)}>
                          <span className={`caret ${collapsed[f._id] ? 'shut' : ''}`}><Icon name="chevron" size={12} /></span>
                          <span className="list-dot"><Icon name="folder" size={15} /></span>
                          <span className="grow ellipsis">{f.name}</span>
                          {canWrite && (
                            <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="mini-btn" title="New list in folder" aria-label={`New list in ${f.name}`} onClick={() => { open(f._id); setAdding({ kind: 'list', space: s._id, folder: f._id }); }}><Icon name="plus" size={14} /></button>
                              <button className="mini-btn" title="More" aria-label={`More actions for ${f.name}`} onClick={() => setMenu(menu === f._id ? null : f._id)}><Icon name="dots" size={14} /></button>
                            </span>
                          )}
                        </div>
                      )}
                      {menu === f._id && (
                        <div className="tree-menu" onMouseLeave={() => setMenu(null)}>
                          <button onClick={() => { setMenu(null); setRenaming({ kind: 'folder', id: f._id }); }}>Rename folder</button>
                          <button className="danger" onClick={() => { setMenu(null); removeFolder(f); }}>Delete folder</button>
                        </div>
                      )}
                      {!collapsed[f._id] && (
                        <div className="tree-lists">
                          {lists.map((l) => listRow(l, s))}
                          {lists.length === 0 && !addingHere('list', s._id, f._id) && <div className="tree-empty">Empty folder</div>}
                          {addingHere('list', s._id, f._id) && (
                            <InlineInput placeholder="List name" onSubmit={(v) => addList(s._id, f._id, v)} onCancel={() => setAdding(null)} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {addingHere('folder', s._id) && <InlineInput placeholder="Folder name" onSubmit={(v) => addFolder(s._id, v)} onCancel={() => setAdding(null)} />}
                {loose.map((l) => listRow(l, s))}
                {addingHere('list', s._id) && <InlineInput placeholder="List name" onSubmit={(v) => addList(s._id, null, v)} onCancel={() => setAdding(null)} />}
              </div>
            )}
          </div>
        );
      })}

      {adding?.kind === 'space' && <InlineInput placeholder="Space name" onSubmit={addSpace} onCancel={() => setAdding(null)} />}
      {error && <div className="err tree-err">{error}</div>}
    </>
  );
}

// Small text box: Enter saves, Escape or blur with no text cancels
function InlineInput({ initial = '', placeholder, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial);
  const submit = (e) => {
    e.preventDefault();
    const v = value.trim();
    if (v) onSubmit(v); else onCancel();
  };
  return (
    <form className="inline-add" onSubmit={submit}>
      <input
        autoFocus
        className="in"
        placeholder={placeholder}
        value={value}
        maxLength={100}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        onBlur={() => { if (!value.trim()) onCancel(); }}
      />
    </form>
  );
}
