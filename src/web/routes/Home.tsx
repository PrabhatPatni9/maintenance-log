import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import { db } from '../lib/db';
import type { CachedMachine, CachedShed } from '../lib/db';
import { refreshMachines } from '../lib/machines-cache';
import type { LogRecord, ShedStats } from '@shared/types';

const PRESELECT_KEY = 'preselectedShedId';

function HomeInner() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogRecord[] | null>(null);
  const [sheds, setSheds] = useState<CachedShed[]>([]);
  const [machines, setMachines] = useState<CachedMachine[]>([]);
  const [query, setQuery] = useState('');
  const [shedStats, setShedStats] = useState<{ shed: CachedShed; stats: ShedStats } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    api
      .get<{ logs: LogRecord[] }>(`/logs?since=${midnight.getTime()}`)
      .then((r) => setLogs(r.logs))
      .catch(() => setLogs([]));

    void db.sheds.toArray().then(setSheds);
    void db.machines.toArray().then(setMachines);
    void refreshMachines()
      .then(() => Promise.all([db.sheds.toArray(), db.machines.toArray()]))
      .then(([s, m]) => {
        setSheds(s);
        setMachines(m);
      })
      .catch(() => {});
  }, []);

  // Two quick answers, not a navigation: a machine number takes the
  // operator straight to that machine's history, a shed code or name shows
  // their own footprint in it right here (CLAUDE.md's shed→machine→history
  // flow already gets you both, this is the "pronto" shortcut to the same
  // two questions the team actually asks).
  const machineMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return machines.filter((m) => m.machineNo.toLowerCase().includes(q)).slice(0, 8);
  }, [query, machines]);

  const shedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sheds.filter((s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 5);
  }, [query, sheds]);

  function pickShed(shed: CachedShed) {
    setShedStats(null);
    setStatsLoading(true);
    api
      .get<ShedStats>(`/sheds/${shed.id}/stats`)
      .then((stats) => setShedStats({ shed, stats }))
      .catch(() => setShedStats(null))
      .finally(() => setStatsLoading(false));
  }

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
      <p className="meta" style={{ marginBottom: 16 }}>
        {t('home.greeting', { name: user?.name ?? '' })}
      </p>

      <input
        className="input"
        style={{ marginBottom: query ? 8 : 20 }}
        placeholder={t('home.searchPlaceholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShedStats(null);
        }}
      />

      {query.trim() && (
        <div className="panel" style={{ padding: 12, marginBottom: 20 }}>
          {machineMatches.length === 0 && shedMatches.length === 0 && !shedStats && !statsLoading && (
            <p className="meta">{t('home.searchNoMatch', { query })}</p>
          )}

          {machineMatches.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: shedMatches.length > 0 ? 12 : 0 }}>
              {machineMatches.map((m) => (
                <button
                  key={m.id}
                  className="btn btn-small"
                  onClick={() => void navigate({ to: '/machine/$machineId', params: { machineId: m.id } })}
                >
                  {m.machineNo} · {m.shedCode}
                </button>
              ))}
            </div>
          )}

          {shedMatches.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {shedMatches.map((s) => (
                <button key={s.id} className="btn btn-small" onClick={() => pickShed(s)}>
                  {s.code} — {s.name}
                </button>
              ))}
            </div>
          )}

          {statsLoading && <p className="meta" style={{ marginTop: 10 }}>{t('common.loading')}</p>}

          {shedStats && (
            <div className="meta" style={{ marginTop: 10 }}>
              {t('home.shedStatsMachines', { code: shedStats.shed.code, count: String(shedStats.stats.machinesWorkedOn) })}
              <br />
              {t('home.shedStatsLogs', { count: String(shedStats.stats.logCount) })}
            </div>
          )}
        </div>
      )}

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
