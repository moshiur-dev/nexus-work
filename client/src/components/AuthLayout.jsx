export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><div className="mark">N</div>Nexus Work</div>
        <h2>{title}</h2>
        <p className="sub">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
