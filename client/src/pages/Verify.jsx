import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, setAccessToken } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

// Opened from the sign-up email: creates the account, then signs the person in
export default function Verify() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { setUser } = useAuth();
  const [state, setState] = useState({ status: 'working' });
  const started = useRef(false); // the link works once

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) return setState({ status: 'error', message: 'This link is missing its token.' });
    api.verifyEmail(token)
      .then((r) => { setAccessToken(r.accessToken); setUser(r.user); setState({ status: 'ok' }); })
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [token]);

  if (state.status === 'working') return <AuthLayout title="Confirming your email…" subtitle="One moment." />;
  if (state.status === 'error') {
    return (
      <AuthLayout title="Link not accepted" subtitle={state.message}>
        <p className="center"><Link to="/register" className="link">Sign up again</Link> · <Link to="/login" className="link">Log in</Link></p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Your account is ready" subtitle="Your email is confirmed.">
      <p className="center"><Link to="/" className="link">Open workspace</Link></p>
    </AuthLayout>
  );
}
