import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { isEmail } from '../utils/validate.js';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otp, setOtp] = useState('');

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.email) next.email = 'Email is required';
    else if (!isEmail(form.email)) next.email = 'Enter a valid email';
    if (!form.password) next.password = 'Password is required';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    setServerError('');
    try {
      await login(needsOtp ? { ...form, otp } : form); // redirects automatically via GuestOnly once user is set
    } catch (err) {
      if (err.code === 'TWO_FACTOR_REQUIRED' || err.code === 'BAD_OTP') {
        setNeedsOtp(true);
        setServerError(err.code === 'BAD_OTP' ? 'That code is not valid. Try the latest code from your app.' : '');
      } else {
        setServerError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Log in to Nexus" subtitle="Welcome back. Enter your details.">
      <form onSubmit={onSubmit} noValidate>
        <label>Email</label>
        <input className="in" name="email" type="email" value={form.email} onChange={onChange} />
        <div className="err">{errors.email}</div>

        <label>Password</label>
        <input className="in" name="password" type="password" value={form.password} onChange={onChange} />
        <div className="err">{errors.password}</div>

        {needsOtp && (
          <>
            <label>Authenticator code</label>
            <input className="in" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
          </>
        )}

        <div className="row between">
          <Link to="/forgot-password" className="link">Forgot password?</Link>
        </div>
        {serverError && <div className="err server">{serverError}</div>}

        <button className="btn primary full" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="center mt">
        No account? <Link to="/register" className="link">Sign up</Link>
      </p>
    </AuthLayout>
  );
}
