import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { isEmail, passwordScore } from '../utils/validate.js';

const STRENGTH_COLORS = ['#dc2626', '#d97706', '#eab308', '#16a34a', '#16a34a'];

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '', terms: false });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  const onChange = (e) => {
    const { name, type, checked, value } = e.target;
    setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const next = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters';
    if (!isEmail(form.email)) next.email = 'Enter a valid email';
    if (form.password.length < 8) next.password = 'Use at least 8 characters';
    if (form.workspaceName.trim().length < 2) next.workspaceName = 'Workspace name is required';
    if (!form.terms) next.terms = 'Please accept the terms';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    setServerError('');
    try {
      await register(form);
    } catch (err) {
      // Server validation errors come back with field details
      if (err.details) {
        const map = {};
        err.details.forEach((d) => (map[d.field] = d.message));
        setErrors(map);
      } else {
        setServerError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const score = passwordScore(form.password);

  return (
    <AuthLayout title="Create your account" subtitle="Free forever. No credit card needed.">
      <form onSubmit={onSubmit} noValidate>
        <label>Full name</label>
        <input className="in" name="name" value={form.name} onChange={onChange} />
        <div className="err">{errors.name}</div>

        <label>Work email</label>
        <input className="in" name="email" type="email" value={form.email} onChange={onChange} />
        <div className="err">{errors.email}</div>

        <label>Password</label>
        <input className="in" name="password" type="password" value={form.password} onChange={onChange} />
        <div className="strength"><i style={{ width: `${score * 25}%`, background: STRENGTH_COLORS[score] }} /></div>
        <div className="err">{errors.password}</div>

        <label>Workspace name</label>
        <input className="in" name="workspaceName" value={form.workspaceName} onChange={onChange} />
        <div className="err">{errors.workspaceName}</div>

        <label className="check-row">
          <input type="checkbox" name="terms" checked={form.terms} onChange={onChange} />
          I agree to the Terms and Privacy Policy
        </label>
        <div className="err">{errors.terms}</div>
        {serverError && <div className="err server">{serverError}</div>}

        <button className="btn primary full" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="center mt">
        Already have an account? <Link to="/login" className="link">Log in</Link>
      </p>
    </AuthLayout>
  );
}
