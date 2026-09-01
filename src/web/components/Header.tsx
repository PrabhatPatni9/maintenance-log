import { Link } from '@tanstack/react-router';
import { useT } from '../i18n';

export function Header() {
  const t = useT();

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--panel)',
      }}
    >
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
        <img src="/icons/icon-48.png" alt="" width={32} height={32} />
        <strong style={{ fontSize: 16 }}>{t('common.appName')}</strong>
      </Link>
      <Link to="/settings" aria-label={t('settings.title')} style={{ color: 'var(--steel)' }}>
        ⚙
      </Link>
    </header>
  );
}
