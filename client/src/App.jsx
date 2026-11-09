import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import Verify from './pages/Verify.jsx';
import Workspace from './pages/Workspace.jsx';
import { TrackerProvider } from './context/TrackerContext.jsx';

// Logged-out visitors are sent to /login and returned to the page they asked for
function Protected({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="center">Loading…</div>;
  if (user) return children;
  const next = location.pathname + location.search;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}

function GuestOnly({ children }) {
  const { user, ready } = useAuth();
  const [params] = useSearchParams();
  if (!ready) return <div className="center">Loading…</div>;
  if (!user) return children;
  const next = params.get('next');
  // Only same-site paths are allowed, so the redirect cannot leave the app
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return <Navigate to={safe} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite" element={<AcceptInvite />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/*" element={<Protected><TrackerProvider><Workspace /></TrackerProvider></Protected>} />
    </Routes>
  );
}
