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
    <div className="screen">
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
        <ul className="stack-list">
          {logs.map((log) => {
            const text = log.transcript?.trim() || log.typedNote?.trim() || '';
            return (
              <li key={log.id} className="panel">
                <Link to="/logs/$logId" params={{ logId: log.id }} className="record-link">
                  <div className="record-time">
                    {new Date(log.clientCreatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="record-text">{text || t('capture.savedOffline')}</div>
                    <div className="meta">
                      {log.status === 'approved' ? t('review.approved') : log.status}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
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
