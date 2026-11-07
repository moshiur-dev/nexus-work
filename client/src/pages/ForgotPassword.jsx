import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import AuthLayout from '../components/AuthLayout.jsx';
import { isEmail } from '../utils/validate.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!isEmail(email)) return setError('Enter a valid email');
    setError('');
    setLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send a reset link.">
      {message ? (
        <div className="note">{message}</div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <label>Email</label>
          <input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="err">{error}</div>
          <button className="btn primary full" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="center mt">
        <Link to="/login" className="link">Back to log in</Link>
      </p>
    </AuthLayout>
  );
}
