import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n';
import { onQueueChange, pendingCount } from '../lib/queue';

export function Header() {
  const t = useT();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const refresh = () => void pendingCount().then(setPending);
    refresh();
    return onQueueChange(refresh);
  }, []);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {pending > 0 && (
          <span
            aria-label={t('home.queueLabel')}
            style={{
              background: 'var(--queue)',
              color: '#fff',
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {t('home.queueLabel')}: {pending}
          </span>
        )}
        <Link to="/settings" aria-label={t('settings.title')} style={{ color: 'var(--steel)' }}>
          ⚙
        </Link>
      </div>
    </header>
  );
}
