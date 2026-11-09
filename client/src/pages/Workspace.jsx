import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SECTIONS, RAIL, SIDE } from '../sections.js';
import Icon from '../components/Icon.jsx';
import Section from './Section.jsx';
import Members from '../components/Members.jsx';
import SpacesTree from '../components/SpacesTree.jsx';
import ListView from '../components/ListView.jsx';
import ChatView from '../components/ChatView.jsx';
import SearchBox from '../components/SearchBox.jsx';
import NewTaskModal from '../components/NewTaskModal.jsx';
import { TrackerBar } from '../context/TrackerContext.jsx';
import { HomeView, MyTasksView, InboxView } from '../components/HomeViews.jsx';
import TimeView from '../components/TimeView.jsx';
import SuperAdmin from '../components/SuperAdmin.jsx';

const ACTIVE_KEY = 'nexus.active';


export default function Workspace() {
  const { user, logout, setUser } = useAuth();
  const [active, setActive] = useState(() => localStorage.getItem(ACTIVE_KEY) || 'home');
  const [spaces, setSpaces] = useState(null);
  const [ws, setWs] = useState(null);
  const [wsError, setWsError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Set when a search result points inside a page: the task to open, or the chat channel
  const [target, setTarget] = useState({});
  const [creating, setCreating] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const reloadSpaces = () => api.listSpaces().then((r) => setSpaces(r.data)).catch(() => {});

  // Live updates: keep a stream open and turn each change into a "nexus:live" window event
  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    (async () => {
      while (!stopped) {
        try {
          const res = await api.eventStream(ctrl.signal);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i);
              buf = buf.slice(i + 2);
              if (chunk.startsWith('data: ')) {
                try { window.dispatchEvent(new CustomEvent('nexus:live', { detail: JSON.parse(chunk.slice(6)) })); } catch { /* bad line */ }
              }
            }
          }
        } catch { /* offline or logged out; try again below */ }
        if (!stopped) await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => { stopped = true; ctrl.abort(); };
  }, []);

  // React to live changes: sidebar and Inbox badge
  useEffect(() => {
    let t = null;
    const onLive = (e) => {
      if (e.detail.type === 'notification') refreshUnread();
      if (e.detail.type === 'spaces') { clearTimeout(t); t = setTimeout(reloadSpaces, 300); }
    };
    window.addEventListener('nexus:live', onLive);
    return () => { window.removeEventListener('nexus:live', onLive); clearTimeout(t); };
  }, []);

  // Unread Inbox count, refreshed every 30 seconds
  const refreshUnread = () => api.notificationCount().then((r) => setUnread(r.unread)).catch(() => {});
  useEffect(() => {
    refreshUnread();
    const t = setInterval(refreshUnread, 30000);
    return () => clearInterval(t);
  }, []);

  // Escape closes the mobile menu
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load the active workspace and its real role, which replaces the role stored on the user
  useEffect(() => {
    api.workspace()
      .then((w) => { setWs(w); setUser({ ...user, role: w.role, workspaceName: w.name }); })
      .catch((err) => setWsError(err.message));
    api.listSpaces().then((r) => setSpaces(r.data)).catch(() => setSpaces([]));
  }, []);

  // Remember the open page across reloads
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, active); }, [active]);

  if (wsError) return <div className="center err">{wsError}</div>;
  if (!ws || !spaces) return <div className="center">Loading…</div>;

  const current = SECTIONS.find((s) => s.id === active);
  // `n` makes the list view reopen a task even when the same task is picked twice
  const go = (id, extra = {}) => { setActive(id); setTarget(extra.taskId ? { ...extra, n: Date.now() } : extra); setMenuOpen(false); setSearch(''); };
  const canWrite = ['owner', 'admin', 'member'].includes(user.role);
  const openTask = (t) => (t.list ? go(`list:${t.list}`, { taskId: t._id }) : go('mywork'));

  // The open list, if the active page is "list:<id>"
  const listId = active.startsWith('list:') ? active.slice(5) : null;
  const openSpace = listId && spaces.find((s) => s.lists.some((l) => l._id === listId));
  const openList = openSpace?.lists.find((l) => l._id === listId);

  const patchList = (id, patch) => setSpaces((all) => all.map((s) => ({ ...s, lists: s.lists.map((l) => (l._id === id ? { ...l, ...patch } : l)) })));
  const renameList = async () => {
    const name = window.prompt('List name', openList.name)?.trim();
    if (!name || name === openList.name) return;
    try { await api.updateList(openList._id, { name }); patchList(openList._id, { name }); } catch (err) { window.alert(err.message); }
  };
  const deleteList = async () => {
    if (!window.confirm(`Delete list "${openList.name}" and its ${openList.total} task(s)? This cannot be undone.`)) return;
    try {
      await api.deleteList(openList._id);
      setSpaces((all) => all.map((s) => ({ ...s, lists: s.lists.filter((l) => l._id !== openList._id) })));
      go('home');
    } catch (err) { window.alert(err.message); }
  };

  const title = active === 'home' ? 'Home' : active === 'mywork' ? 'My Work' : active === 'settings' ? 'Settings' : current?.title;
  const wsName = user.workspaceName || 'My Workspace';

  const railSections = RAIL.map((id) => SECTIONS.find((s) => s.id === id)).filter(Boolean);
  const sideSections = SIDE.map((id) => SECTIONS.find((s) => s.id === id)).filter(Boolean);
  const moreSections = SECTIONS.filter((s) => !RAIL.includes(s.id) && !SIDE.includes(s.id));
  const moreActive = moreSections.some((s) => s.id === active);

  return (
    <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Icon name="menu" size={20} /></button>
        <button className="ws-pill" onClick={() => go('settings')} title="Workspace settings">
          <span className="ws-badge">{wsName[0]?.toUpperCase()}</span>
          <span className="top-ws-name">{wsName}</span>
          <Icon name="chevron" size={14} />
        </button>
        <SearchBox value={search} onChange={setSearch}
          onPick={({ page, taskId, channelId }) => go(page, { taskId, channelId })} />
        <div className="top-right">
          <button className="icon-btn top-time" aria-label="Time tracking" title="Time tracking and screenshots" onClick={() => go('timesheets')}><Icon name="clock" size={20} /></button>
          <button className="icon-btn top-create" aria-label="Create task" title="Create task" onClick={() => setCreating(true)}><Icon name="plus" size={20} /></button>
          <div className="avatar" title={`${user.name} · ${user.email}`}>{user.name?.[0]?.toUpperCase()}</div>
        </div>
      </header>

      <div className="backdrop" onClick={() => setMenuOpen(false)} />

      <TrackerBar onOpenTask={(entry) => entry.taskList ? go(`list:${entry.taskList}`, { taskId: entry.task }) : go('mywork')} />

      {creating && (
        <NewTaskModal spaces={spaces} members={ws.members} defaultListId={listId}
          onClose={() => setCreating(false)}
          onNeedList={() => { setCreating(false); setMenuOpen(true); }}
          onCreated={(task) => {
            setCreating(false);
            // New tasks open on the Board, with the task's details in front
            localStorage.setItem('nexus.viewMode', 'board');
            go(`list:${task.list}`, { taskId: task._id });
          }} />
      )}

      {/* Icon rail: the main apps, always visible on wide screens */}
      <nav className="rail" aria-label="Apps">
        <RailItem id="home" label="Home" icon="home" active={active === 'home' || active === 'mywork' || active.startsWith('list:')} onClick={go} />
        {railSections.map((s) => (
          <RailItem key={s.id} id={s.id} label={RAIL_LABEL[s.id] || s.label} icon={s.icon} active={active === s.id} onClick={go} />
        ))}
        <RailItem id="more" label="More" icon="dots" active={moreActive} onClick={() => setMoreOpen(true)} />
        <div className="grow" />
        <RailItem id="settings" label="Settings" icon="gear" active={active === 'settings'} onClick={go} />
      </nav>

      <aside className="side">
        <div className="side-head">
          <h2 className="side-title">Home</h2>
          <button className="btn dark small create-side" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Create</button>
          <button className="icon-btn close-btn" aria-label="Close menu" onClick={() => setMenuOpen(false)}><Icon name="x" /></button>
        </div>

        <Nav id="home" label="Home" icon="home" active={active} onClick={go} />
        <Nav id="mywork" label="My Tasks" icon="check" active={active} onClick={go} />
        {sideSections.map((s) => <Nav key={s.id} id={s.id} label={s.label} icon={s.icon} active={active} onClick={go} badge={s.id === 'inbox' ? unread : 0} />)}
        <div className={`nav more-toggle ${moreActive && !moreOpen ? 'on' : ''}`} onClick={() => setMoreOpen(!moreOpen)}>
          <span className="ic"><Icon name="dots" /></span>More
          <span className={`more-caret ${moreOpen ? 'open' : ''}`}><Icon name="chevron" size={14} /></span>
        </div>
        {moreOpen && moreSections.map((s) => <Nav key={s.id} id={s.id} label={s.label} icon={s.icon} active={active} onClick={go} indent />)}

        {/* On phones the rail is hidden, so its apps are listed here */}
        <div className="mobile-apps">
          <div className="grp">Apps</div>
          {railSections.filter((s) => !SIDE.includes(s.id)).map((s) => <Nav key={s.id} id={s.id} label={s.label} icon={s.icon} active={active} onClick={go} />)}
          <Nav id="settings" label="Settings" icon="gear" active={active} onClick={go} />
        </div>

        <div className="side-divider" />
        <SpacesTree spaces={spaces} reload={reloadSpaces} active={active} onOpen={go} canWrite={canWrite} />

        <div className="me">
          <span className="avatar sm">{user.name?.[0]?.toUpperCase()}</span>
          <div className="grow me-text">{user.name}<small>{user.email} · {user.role}</small></div>
          <button className="icon-btn" aria-label="Log out" title="Log out" onClick={logout}><Icon name="logout" size={18} /></button>
        </div>
      </aside>

      <main className="main">
        {!openList && current?.id !== 'chat' && (
          <div className="page-head">
            <span className="page-ic"><Icon name={current?.icon || PAGE_ICON[active] || 'home'} /></span>
            <h1>{title}</h1>
          </div>
        )}
        {listId && !openList && <div className="card muted">This list no longer exists. <span className="link" onClick={() => go('home')}>Go home</span></div>}
        {openList && (
          <ListView key={`${openList._id}:${target.n || ''}`} openTaskId={target.taskId} space={openSpace} list={openList} members={ws.members} canWrite={canWrite}
            onCountsChange={(id, total, open) => patchList(id, { total, open })}
            onRenameList={renameList} onDeleteList={deleteList}
            onStatusesChange={(statuses) => patchList(openList._id, { statuses })} />
        )}

        {active === 'home' && <HomeView user={user} spaces={spaces} onOpenTask={openTask} onGo={go} />}
        {active === 'mywork' && <MyTasksView spaces={spaces} onOpenTask={openTask} />}
        {current?.id === 'inbox' && <InboxView onOpenTask={openTask} onCountChange={refreshUnread} />}
        {current?.id === 'timesheets' && <TimeView members={ws.members} onOpenTask={openTask} />}
        {current?.id === 'chat' && <ChatView key={`chat:${target.channelId || ''}`} members={ws.members} openChannelId={target.channelId} />}
        {current && !['chat', 'inbox', 'timesheets'].includes(current.id) && <Section key={current.id} section={current} />}
        {active === 'settings' && <Settings user={user} setUser={setUser} />}
      </main>
    </div>
  );
}

const RAIL_LABEL = { dashboards: 'Dashboard', whiteboards: 'Boards', timesheets: 'Time' };
const PAGE_ICON = { home: 'home', mywork: 'check', settings: 'gear' };

function RailItem({ id, label, icon, active, onClick }) {
  return (
    <button className={`rail-item ${active ? 'on' : ''}`} onClick={() => onClick(id)} title={label} aria-current={active ? 'page' : undefined}>
      <span className="rail-ic"><Icon name={icon} size={20} /></span>
      <span className="rail-label">{label}</span>
    </button>
  );
}

function Nav({ id, label, icon, active, onClick, indent, badge }) {
  return (
    <div className={`nav ${active === id ? 'on' : ''} ${indent ? 'indent' : ''}`} onClick={() => onClick(id)}>
      <span className="ic"><Icon name={icon} /></span>{label}
      {badge > 0 && <span className="nav-badge" aria-label={`${badge} unread`}>{badge > 99 ? '99+' : badge}</span>}
    </div>
  );
}

// Settings: profile and workspace name are saved; billing, 2FA and SSO are placeholders
function Settings({ user, setUser }) {
  const [name, setName] = useState(user.name);
  const [workspaceName, setWorkspaceName] = useState(user.workspaceName || '');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      const res = await api.updateProfile({ name, workspaceName });
      setUser(res.user);
      setMsg('Saved');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <>
      <form className="card stack-form" onSubmit={save}>
        <label>Full name</label>
        <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
        <label>Workspace name</label>
        <input className="in" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
        <label>Email</label>
        <input className="in" value={user.email} disabled />
        <div className="row">
          <button className="btn primary">Save</button>
          {msg && <span className="ok">{msg}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      </form>
      <div className="card download-card">
        <div>
          <b>Desktop app for Windows</b>
          <div className="muted">Tracks time automatically with screenshots and activity counts. Install once, then sign in with your Nexus account.</div>
        </div>
        <a className="btn primary" href="https://github.com/moshiur-dev/nexus-work/releases/latest/download/Nexus-Tracker-Setup-1.0.0.exe" download>Download (Windows, 82 MB)</a>
      </div>
      {user.isSuperAdmin && <SuperAdmin />}
      <Members user={user} />
      <TwoFactor user={user} setUser={setUser} />
      <div className="card muted">Billing and SSO are not connected yet.</div>
    </>
  );
}

// Two-factor authentication: scan a QR code with an authenticator app, then confirm with a code.
function TwoFactor({ user, setUser }) {
  const [setup, setSetup] = useState(null); // { secret, qr } while enrolling
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const start = async () => {
    setErr(''); setMsg('');
    try {
      setSetup(await api.twoFactorSetup());
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const enable = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      const res = await api.twoFactorEnable(code);
      setUser(res.user);
      setSetup(null);
      setCode('');
      setMsg('Two-factor authentication is on');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const disable = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      const res = await api.twoFactorDisable(code);
      setUser(res.user);
      setCode('');
      setMsg('Two-factor authentication is off');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  if (user.twoFactorEnabled) {
    return (
      <form className="card stack-form" onSubmit={disable}>
        <b>Two-factor authentication: on</b>
        <label>Enter a current code to turn it off</label>
        <input className="in" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        <div className="row">
          <button className="btn">Turn off 2FA</button>
          {msg && <span className="ok">{msg}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      </form>
    );
  }

  if (!setup) {
    return (
      <div className="card stack-form">
        <b>Two-factor authentication: off</b>
        <div className="row">
          <button className="btn primary" onClick={start}>Set up 2FA</button>
          {msg && <span className="ok">{msg}</span>}
          {err && <span className="err">{err}</span>}
        </div>
      </div>
    );
  }

  return (
    <form className="card stack-form" onSubmit={enable}>
      <b>Scan this QR code with your authenticator app</b>
      <img src={setup.qr} alt="2FA setup QR code" width="180" height="180" />
      <div className="muted">Or enter this key manually: <code>{setup.secret}</code></div>
      <label>6-digit code from the app</label>
      <input className="in" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <div className="row">
        <button className="btn primary">Confirm and turn on</button>
        <button type="button" className="btn" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
        {err && <span className="err">{err}</span>}
      </div>
    </form>
  );
}
