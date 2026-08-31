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
      <img src="/icons/icon-128.png" alt="" width={64} height={64} style={{ marginBottom: 24 }} />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 360 }}>
        <input
          className="btn btn-block"
          style={{ textAlign: 'left' }}
          type="tel"
          inputMode="tel"
          placeholder={t('auth.phoneLabel')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <input
          className="btn btn-block"
          style={{ textAlign: 'left' }}
          type="password"
          placeholder={t('auth.passwordLabel')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p style={{ color: 'var(--fault)' }}>{t('auth.loginError')}</p>}
        <button className="btn btn-amber btn-block" type="submit" disabled={busy}>
          {busy ? t('auth.loggingIn') : t('auth.loginButton')}
        </button>
      </form>
    </div>
  );
}
