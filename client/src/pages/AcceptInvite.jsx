import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, setAccessToken } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

// Invite link: works for a signed-in person with the invited email, and for a new person who sets a password
export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, setUser } = useAuth();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(null); // workspace name once joined

  useEffect(() => {
    if (!token) return setError('This invite link is missing its token.');
    api.invitePreview(token).then(setInfo).catch((err) => setError(err.message));
  }, [token]);

  if (joined !== null) {
    return (
      <AuthLayout title="You have joined" subtitle={`Welcome to ${joined || 'the workspace'}.`}>
        <p className="center"><Link to="/" className="link">Open workspace</Link></p>
      </AuthLayout>
    );
  }
  if (error) {
    return (
      <AuthLayout title="Invite not accepted" subtitle={error}>
        <p className="center"><Link to="/" className="link">Go to my workspace</Link></p>
      </AuthLayout>
    );
  }
  if (!info) return <AuthLayout title="Opening invite…" subtitle="One moment." />;

  if (user) {
    if (user.email !== info.email) {
      return (
        <AuthLayout title="Wrong account" subtitle={`This invite is for ${info.email}. Log out and sign in with that account.`}>
          <p className="center"><Link to="/" className="link">Back</Link></p>
        </AuthLayout>
      );
    }
    return <SignedInJoin token={token} info={info} onJoined={setJoined} />;
  }

  if (info.hasAccount) {
    const next = encodeURIComponent(`/invite?token=${token}`);
    return (
      <AuthLayout title={`Join ${info.workspaceName}`} subtitle={`An account for ${info.email} already exists.`}>
        <p className="center"><Link to={`/login?next=${next}`} className="link">Log in to accept the invite</Link></p>
      </AuthLayout>
    );
  }

  return <NewJoin token={token} info={info} onJoined={setJoined} setUser={setUser} />;
}

function SignedInJoin({ token, info, onJoined }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const join = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.acceptInvite(token);
      onJoined(r.workspaceName);
    } catch (ex) {
      setErr(ex.message);
      setBusy(false);
    }
  };
  return (
    <AuthLayout title={`Join ${info.workspaceName}`} subtitle={`You will join as ${info.role}.`}>
      <button className="btn primary full" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Accept invite'}</button>
      {err && <div className="err server">{err}</div>}
    </AuthLayout>
  );
}

function NewJoin({ token, info, onJoined, setUser }) {
  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (form.name.trim().length < 2) return setErr('Name must be at least 2 characters');
    if (form.password.length < 8) return setErr('Password must be at least 8 characters');
    if (form.password !== form.confirmPassword) return setErr('Passwords do not match');
    setBusy(true);
    try {
      const r = await api.inviteJoin({ token, ...form });
      setAccessToken(r.accessToken);
      setUser(r.user);
      onJoined(r.workspaceName);
    } catch (ex) {
      setErr(ex.message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={`Join ${info.workspaceName}`} subtitle={`Set up your account for ${info.email}. You will join as ${info.role}.`}>
      <form onSubmit={submit} noValidate>
        <label>Full name</label>
        <input className="in" name="name" value={form.name} onChange={change} />
        <label>New password</label>
        <input className="in" name="password" type="password" value={form.password} onChange={change} />
        <label>Confirm password</label>
        <input className="in" name="confirmPassword" type="password" value={form.confirmPassword} onChange={change} />
        {err && <div className="err server">{err}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Joining…' : 'Create account and join'}</button>
      </form>
    </AuthLayout>
  );
}
