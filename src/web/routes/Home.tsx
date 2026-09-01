import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import { db } from '../lib/db';
import type { CachedShed } from '../lib/db';
import { refreshMachines } from '../lib/machines-cache';
import type { LogRecord } from '@shared/types';

const PRESELECT_KEY = 'preselectedShedId';

function HomeInner() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogRecord[] | null>(null);
  const [sheds, setSheds] = useState<CachedShed[]>([]);

  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    api
      .get<{ logs: LogRecord[] }>(`/logs?since=${midnight.getTime()}`)
      .then((r) => setLogs(r.logs))
      .catch(() => setLogs([]));

    void db.sheds.toArray().then(setSheds);
    void refreshMachines()
      .then(() => db.sheds.toArray())
      .then(setSheds)
      .catch(() => {});
  }, []);

  // Picking a shed here is a shortcut into the exact same flow /machine
  // already has (it already skips the shed step when there is only one) —
  // this just lets the operator start from the shed they want instead of
  // always landing on a generic button first. Passed via sessionStorage
  // rather than a route search param so MachinePicker does not need to know
  // or care whether it was reached this way or the normal way.
  function recordAt(shedId?: string) {
    if (shedId) sessionStorage.setItem(PRESELECT_KEY, shedId);
    else sessionStorage.removeItem(PRESELECT_KEY);
    void navigate({ to: '/machine' });
  }

  return (
    <div className="screen">
      <p className="meta" style={{ marginBottom: 20 }}>
        {t('home.greeting', { name: user?.name ?? '' })}
      </p>

      {sheds.length <= 1 ? (
        <button className="btn btn-amber btn-block record-cta" onClick={() => recordAt()}>
          {t('home.recordButton')}
        </button>
      ) : (
        <>
          <h2 className="dash-section-title" style={{ marginTop: 0 }}>
            {t('home.chooseShedTitle')}
          </h2>
          <div className="home-shed-grid">
            {sheds.map((s) => (
              <button key={s.id} className="home-shed-card" onClick={() => recordAt(s.id)}>
                <span className="shed-badge">{s.code}</span>
                <span className="home-shed-name">{s.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="screen-title" style={{ fontSize: 18, margin: '32px 0 12px' }}>
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
