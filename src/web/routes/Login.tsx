import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { useAuth } from '../lib/auth-context';

export function Login() {
  const t = useT();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (user) void navigate({ to: '/' });
  }, [user, navigate]);

  if (user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await login(phone, password);
      void navigate({ to: '/' });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--base)',
      }}
    >
      <div className="panel" style={{ width: '100%', maxWidth: 360, padding: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <img src="/icons/icon-128.png" alt="" width={56} height={56} style={{ marginBottom: 12 }} />
          <span className="screen-title" style={{ fontSize: 20 }}>
            {t('common.appName')}
          </span>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="field-label" htmlFor="login-phone">
              {t('auth.phoneLabel')}
            </label>
            <input
              id="login-phone"
              className="input"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="field-label" htmlFor="login-password">
              {t('auth.passwordLabel')}
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p style={{ color: 'var(--fault)', fontSize: 15 }}>{t('auth.loginError')}</p>}
          <button className="btn btn-amber btn-block" type="submit" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? t('auth.loggingIn') : t('auth.loginButton')}
          </button>
        </form>
      </div>
    </div>
  );
}
