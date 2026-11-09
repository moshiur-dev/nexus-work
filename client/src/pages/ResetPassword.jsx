import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setAccessToken } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token) return setError('This reset link is missing its token. Request a new one.');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      const r = await api.resetPassword(token, password, confirm);
      setAccessToken(r.accessToken);
      setUser(r.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" subtitle="The link expires one hour after it was sent.">
      <form onSubmit={onSubmit} noValidate>
        <label>New password</label>
        <input className="in" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label>Confirm password</label>
        <input className="in" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <div className="err server">{error}</div>}
        <button className="btn primary full" disabled={loading}>{loading ? 'Saving…' : 'Set new password'}</button>
      </form>
      <p className="center mt"><Link to="/login" className="link">Back to log in</Link></p>
    </AuthLayout>
  );
}
