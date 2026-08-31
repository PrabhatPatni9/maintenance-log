import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import type { LogRecord } from '@shared/types';

function HomeInner() {
  const t = useT();
  const { user } = useAuth();
  const [logs, setLogs] = useState<LogRecord[] | null>(null);

  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    api
      .get<{ logs: LogRecord[] }>(`/logs?since=${midnight.getTime()}`)
      .then((r) => setLogs(r.logs))
      .catch(() => setLogs([]));
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
      <p className="meta" style={{ marginBottom: 20 }}>
        {t('home.greeting', { name: user?.name ?? '' })}
      </p>

      <Link
        to="/machine"
        className="btn btn-amber btn-block"
        style={{
          minHeight: 96,
          fontSize: 22,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 32,
        }}
      >
        {t('home.recordButton')}
      </Link>

      <h2 className="screen-title" style={{ fontSize: 18, marginBottom: 12 }}>
        {t('home.todayLogsTitle')}
      </h2>

      {logs === null && <p className="meta">{t('common.loading')}</p>}
      {logs !== null && logs.length === 0 && <p className="meta">{t('home.noLogsToday')}</p>}
      {logs !== null && logs.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {logs.map((log) => (
            <li key={log.id} className="panel" style={{ marginBottom: 8 }}>
              <Link
                to="/logs/$logId"
                params={{ logId: log.id }}
                style={{ display: 'block', padding: '14px 16px', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{log.transcript?.slice(0, 60) || log.typedNote?.slice(0, 60) || log.status}</span>
                  <span className="meta">{new Date(log.clientCreatedAt).toLocaleTimeString()}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Home() {
  return (
    <RequireAuth>
      <HomeInner />
    </RequireAuth>
  );
}
