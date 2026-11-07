import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { timeAgo } from './ListView.jsx';

const POLL_MS = 3000;

// Chat: channels everyone can see, plus direct messages between two members.
// New messages arrive by polling every few seconds.
export default function ChatView({ members, openChannelId, onChannelOpened }) {
  const { user } = useAuth();
  const myId = String(user.id);
  const canChat = ['owner', 'admin', 'member', 'guest'].includes(user.role);
  const canCreate = ['owner', 'admin', 'member'].includes(user.role);
  const canManage = ['owner', 'admin'].includes(user.role);

  const [channels, setChannels] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [showList, setShowList] = useState(true); // phones show either the list or the conversation
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listChannels()
      .then((r) => {
        setChannels(r.data);
        const want = openChannelId && r.data.find((c) => c._id === openChannelId);
        const first = want || r.data.find((c) => c.name === 'general') || r.data[0];
        if (first) setActiveId(first._id);
        if (want) { setShowList(false); onChannelOpened?.(); }
      })
      .catch((err) => setError(err.message));
  }, []);

  const memberName = (id) => members.find((m) => String(m.userId) === String(id))?.name || 'Former member';
  const title = (c) => {
    if (!c) return '';
    if (c.kind === 'channel') return `# ${c.name}`;
    const other = c.members.find((m) => String(m) !== myId);
    return other ? memberName(other) : `${user.name} (you)`;
  };

  const open = (id) => { setActiveId(id); setShowList(false); };

  const createChannel = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return setAdding(false);
    setError('');
    try {
      const res = await api.createChannel(newName.trim());
      setChannels((cs) => [...cs, res.data].sort((a, b) => (a.kind + (a.name || '')).localeCompare(b.kind + (b.name || ''))));
      setNewName(''); setAdding(false); open(res.data._id);
    } catch (err) {
      setError(err.message);
    }
  };

  const startDm = async (userId) => {
    if (!userId) return;
    setError('');
    try {
      const res = await api.openDm(userId);
      setChannels((cs) => (cs.some((c) => c._id === res.data._id) ? cs : [...cs, res.data]));
      open(res.data._id);
    } catch (err) {
      setError(err.message);
    }
  };

  const removeChannel = async (c) => {
    if (!window.confirm(`Delete #${c.name} and all its messages? This cannot be undone.`)) return;
    try {
      await api.deleteChannel(c._id);
      const rest = channels.filter((x) => x._id !== c._id);
      setChannels(rest);
      setActiveId(rest.find((x) => x.name === 'general')?._id || rest[0]?._id || null);
      setShowList(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!channels) return <div className="muted">{error || 'Loading…'}</div>;
  const active = channels.find((c) => c._id === activeId);
  const rooms = channels.filter((c) => c.kind === 'channel');
  const dms = channels.filter((c) => c.kind === 'dm');
  const dmWith = new Set(dms.flatMap((d) => d.members.map(String)));

  return (
    <div className={`chat ${showList ? 'show-list' : 'show-convo'}`}>
      <aside className="chat-list">
        <div className="chat-grp">
          <span>Channels</span>
          {canCreate && <button className="mini-btn dark" aria-label="New channel" onClick={() => setAdding(true)}>+</button>}
        </div>
        {rooms.map((c) => (
          <div key={c._id} className={`chat-item ${c._id === activeId ? 'on' : ''}`} onClick={() => open(c._id)}>
            <span className="hash">#</span><span className="ellipsis">{c.name}</span>
          </div>
        ))}
        {adding && (
          <form onSubmit={createChannel} className="chat-add">
            <input autoFocus className="in" placeholder="channel-name" value={newName} maxLength={60}
              onChange={(e) => setNewName(e.target.value)} onBlur={() => !newName.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          </form>
        )}

        <div className="chat-grp"><span>Direct messages</span></div>
        {dms.map((c) => (
          <div key={c._id} className={`chat-item ${c._id === activeId ? 'on' : ''}`} onClick={() => open(c._id)}>
            <span className="av sm">{title(c)[0]?.toUpperCase()}</span><span className="ellipsis">{title(c)}</span>
          </div>
        ))}
        {canChat && (
          <select className="in dm-pick" value="" onChange={(e) => startDm(e.target.value)} aria-label="Start a direct message">
            <option value="">+ New message…</option>
            {members.filter((m) => !dmWith.has(String(m.userId)) || String(m.userId) === myId).map((m) => (
              <option key={m.userId} value={m.userId}>{String(m.userId) === myId ? `${m.name} (you)` : m.name}</option>
            ))}
          </select>
        )}
        {error && <div className="err">{error}</div>}
      </aside>

      {active ? (
        <Conversation key={active._id} channel={active} title={title(active)} myId={myId} canChat={canChat}
          canManage={canManage} onBack={() => setShowList(true)} onDeleteChannel={() => removeChannel(active)} />
      ) : (
        <div className="convo muted center">Pick a channel</div>
      )}
    </div>
  );
}

function Conversation({ channel, title, myId, canChat, canManage, onBack, onDeleteChannel }) {
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const lastRef = useRef(null);
  const queueRef = useRef(Promise.resolve()); // sends one message at a time, in order

  // First load, then poll for anything newer than the last message seen
  useEffect(() => {
    let alive = true;
    const merge = (incoming) => {
      if (!incoming.length) return;
      lastRef.current = incoming[incoming.length - 1].createdAt;
      setMessages((ms) => {
        const seen = new Set((ms || []).map((m) => m._id));
        return [...(ms || []), ...incoming.filter((m) => !seen.has(m._id))];
      });
    };
    api.listMessages(channel._id)
      .then((r) => { if (!alive) return; setMessages(r.data); if (r.data.length) lastRef.current = r.data[r.data.length - 1].createdAt; })
      .catch((err) => { setMessages([]); setError(err.message); });
    const poll = () => api.listMessages(channel._id, lastRef.current).then((r) => alive && merge(r.data)).catch(() => {});
    const t = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    // Live: a new message in this channel arrives at once instead of at the next poll
    const onLive = (e) => { if (e.detail.type === 'message' && e.detail.channel === channel._id) poll(); };
    window.addEventListener('nexus:live', onLive);
    return () => { alive = false; clearInterval(t); window.removeEventListener('nexus:live', onLive); };
  }, [channel._id]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);

  // The box clears at once so the next message can be typed; a failed message goes back into the box
  const send = (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody('');
    setError('');
    queueRef.current = queueRef.current.then(async () => {
      try {
        const res = await api.sendMessage(channel._id, text);
        lastRef.current = res.data.createdAt;
        // A poll may already have added it
        setMessages((ms) => (ms.some((m) => m._id === res.data._id) ? ms : [...ms, res.data]));
      } catch (err) {
        setError(err.message);
        setBody((b) => (b ? `${text}
${b}` : text));
      }
    });
  };

  const remove = async (m) => {
    try {
      await api.deleteMessage(m._id);
      setMessages((ms) => ms.filter((x) => x._id !== m._id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="convo">
      <header className="convo-head">
        <button className="icon-btn back-btn" aria-label="Back to conversations" onClick={onBack}>‹</button>
        <b className="ellipsis">{title}</b>
        <div className="grow" />
        {canManage && channel.kind === 'channel' && channel.name !== 'general' && (
          <button className="btn small danger-btn" onClick={onDeleteChannel}>Delete channel</button>
        )}
      </header>

      <div className="msgs">
        {messages === null && <div className="muted">Loading…</div>}
        {messages?.length === 0 && <div className="muted empty-chat">No messages yet. Say hello 👋</div>}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && String(prev.author) === String(m.author) && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60 * 1000;
          const mine = String(m.author) === myId;
          return (
            <div key={m._id} className={`msg ${grouped ? 'grouped' : ''}`}>
              {!grouped ? <span className="av">{m.authorName?.[0]?.toUpperCase()}</span> : <span className="av-space" />}
              <div className="grow msg-main">
                {!grouped && <div className="comment-meta"><b>{m.authorName}</b> <span className="muted">{timeAgo(m.createdAt)}</span></div>}
                <div className="msg-body">{m.body}</div>
              </div>
              {(mine || canManage) && <button className="link-btn msg-del" onClick={() => remove(m)} aria-label="Delete message">Delete</button>}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canChat ? (
        <form className="composer" onSubmit={send}>
          <textarea className="in" rows={1} placeholder={`Message ${title}`} value={body} maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn primary" disabled={!body.trim()}>Send</button>
        </form>
      ) : (
        <div className="muted composer">Your role can read but not send messages.</div>
      )}
      {error && <div className="err convo-err">{error}</div>}
    </section>
  );
}
