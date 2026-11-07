import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthLayout from '../components/AuthLayout.jsx';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ status: 'working' });
  const started = useRef(false); // invites are single-use, so accept only once

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) return setState({ status: 'error', message: 'This invite link is missing its token.' });
    api.acceptInvite(token)
      .then((r) => setState({ status: 'ok', name: r.workspaceName }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [token]);

  if (state.status === 'working') return <AuthLayout title="Joining workspace…" subtitle="One moment." />;

  if (state.status === 'error') {
    return (
      <AuthLayout title="Invite not accepted" subtitle={state.message}>
        <p className="center"><Link to="/" className="link">Go to my workspace</Link></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="You have joined" subtitle={`Welcome to ${state.name || 'the workspace'}.`}>
      <p className="center"><Link to="/" className="link">Open workspace</Link></p>
    </AuthLayout>
  );
}
