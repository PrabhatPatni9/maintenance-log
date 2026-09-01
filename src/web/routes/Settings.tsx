import { Link, useNavigate } from '@tanstack/react-router';
import type { Lang } from '@shared/types';
import { useLang, useT } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { RequireAuth } from '../lib/guards';

const LANGS: { lang: Lang; key: string }[] = [
  { lang: 'hi', key: 'lang.hindi' },
  { lang: 'mr', key: 'lang.marathi' },
  { lang: 'en', key: 'lang.english' },
];

function SettingsInner() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('settings.title')}
      </h1>

      <p className="meta" style={{ marginBottom: 20 }}>
        {user?.name} · {user?.phone}
      </p>

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('settings.languageLabel')}</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        {LANGS.map((l) => (
          <button
            key={l.lang}
            className="btn"
            style={{ background: lang === l.lang ? 'var(--ink)' : undefined, color: lang === l.lang ? 'var(--panel)' : undefined }}
            onClick={() => setLang(l.lang)}
          >
            {t(l.key)}
          </button>
        ))}
      </div>

      {/* The only way into the admin panel, and it is only rendered for an
          admin. An operator never sees that there is one — the server
          enforces it too, so a guessed URL gets them nothing. */}
      {(user?.role === 'admin' || user?.role === 'super_admin') && (
        <Link to="/admin/sheds" className="btn btn-primary btn-block admin-entry">
          {t('settings.adminPanel')}
        </Link>
      )}

      <button
        className="btn btn-block"
        style={{ marginTop: 12 }}
        onClick={() => {
          void logout().then(() => void navigate({ to: '/login' }));
        }}
      >
        {t('auth.logoutButton')}
      </button>
    </div>
  );
}

export function Settings() {
  return (
    <RequireAuth>
      <SettingsInner />
    </RequireAuth>
  );
}
