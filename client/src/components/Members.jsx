import { useEffect, useState } from 'react';
import { api } from '../api.js';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest', viewer: 'Viewer' };
const INVITE_ROLES = ['admin', 'member', 'guest', 'viewer'];

// Settings panel: members, pending invites, invite form and the user's workspaces
export default function Members({ user }) {
  const [ws, setWs] = useState(null);
  const [invites, setInvites] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const isOwner = user.role === 'owner';
  const canManage = isOwner || user.role === 'admin';

  const load = async () => {
    try {
      const w = await api.workspace();
      setWs(w);
      setWorkspaces((await api.listWorkspaces()).data);
      if (canManage) setInvites((await api.listInvites()).data);
    } catch (ex) {
      setErr(ex.message);
    }
  };
  useEffect(() => { load(); }, []);

  const run = async (fn, ok) => {
    setErr(''); setMsg('');
    try {
      await fn();
      setMsg(ok);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  // Admins can only be changed by the owner; the owner row is never editable
  const canEditRow = (m) => canManage && m.role !== 'owner' && (isOwner || m.role !== 'admin');
  const roleOptions = isOwner ? INVITE_ROLES : INVITE_ROLES.filter((r) => r !== 'admin');

  if (!ws) return <div className="card muted">Loading members…</div>;

  return (
    <>
      <div className="card">
        <b>Members of {ws.name}</b>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {ws.members.map((m) => (
              <tr key={m.userId}>
                <td>{m.name}</td>
                <td className="muted">{m.email}</td>
                <td>
                  {canEditRow(m) ? (
                    <select className="in small-in" value={m.role}
                      onChange={(e) => run(() => api.setMemberRole(m.userId, e.target.value), 'Role updated')}>
                      {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : ROLE_LABEL[m.role]}
                </td>
                <td>
                  {canEditRow(m) && (
                    <button className="btn small" onClick={() => run(() => api.removeMember(m.userId), 'Member removed')}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {canManage && (
        <div className="card stack-form">
          <b>Invite someone</b>
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            run(async () => { await api.invite(email, role); setEmail(''); }, 'Invite sent');
          }}>
            <input className="in" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="in small-in" value={role} onChange={(e) => setRole(e.target.value)}>
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn primary">Send invite</button>
          </form>
          {invites.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th>Pending invite</th><th>Role</th><th>Expires</th><th></th></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i._id}>
                    <td>{i.email}</td>
                    <td>{ROLE_LABEL[i.role]}</td>
                    <td className="muted">{new Date(i.expiresAt).toLocaleDateString()}</td>
                    <td><button className="btn small" onClick={() => run(() => api.cancelInvite(i._id), 'Invite cancelled')}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      <div className="card">
        <b>Your workspaces</b>
        {workspaces.map((w) => (
          <div key={w.id} className="row between">
            <span>{w.name} <span className="muted">· {ROLE_LABEL[w.role]}</span></span>
            {w.id !== ws.id && (
              <button className="btn small" onClick={async () => {
                await api.switchWorkspace(w.id);
                window.location.href = '/';
              }}>Switch</button>
            )}
          </div>
        ))}
      </div>

      <div className="err">{err}</div>
      {msg && <div className="ok">{msg}</div>}
    </>
  );
}
