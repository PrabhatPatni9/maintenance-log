import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useLang, useT } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import { db } from '../lib/db';
import type { CachedMachine, CachedShed } from '../lib/db';
import { refreshMachines } from '../lib/machines-cache';
import { LogListItem } from '../components/LogListItem';
import { labelFor } from '@shared/taxonomy';
import type { LogSummary, ShedStats, TaxonomyItemRecord } from '@shared/types';

const PRESELECT_KEY = 'preselectedShedId';
const METER_PRESELECT_KEY = 'preselectedMeterShedId';

function HomeInner() {
  const t = useT();
  const { lang } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogSummary[] | null>(null);
  const [sheds, setSheds] = useState<CachedShed[]>([]);
  const [machines, setMachines] = useState<CachedMachine[]>([]);
  const [query, setQuery] = useState('');
  const [shedStats, setShedStats] = useState<{ shed: CachedShed; stats: ShedStats } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [logQuery, setLogQuery] = useState('');
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    api
      .get<{ logs: LogSummary[] }>(`/logs?since=${midnight.getTime()}`)
      .then((r) => setLogs(r.logs))
      .catch(() => setLogs([]));

    void db.sheds.toArray().then(setSheds);
    void db.machines.toArray().then(setMachines);
    void db.taxonomy.toArray().then((items) => {
      setLabels(new Map(items.map((i) => [i.code, labelFor(i as unknown as TaxonomyItemRecord, lang)])));
    });
    void refreshMachines()
      .then(() => Promise.all([db.sheds.toArray(), db.machines.toArray()]))
      .then(([s, m]) => {
        setSheds(s);
        setMachines(m);
      })
      .catch(() => {});
  }, [lang]);

  // Filters the list already on screen — today's logs is a short list, so a
  // second round trip to the server for this would be answering a "did I
  // already log X" question slower than just looking. Matches the machine,
  // the shed, the transcript, or any pill's label in the operator's language.
  const filteredLogs = useMemo(() => {
    if (!logs) return logs;
    const q = logQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => {
      const text = (log.transcript ?? '') + ' ' + (log.typedNote ?? '');
      if (text.toLowerCase().includes(q)) return true;
      if (log.machineNo.toLowerCase().includes(q) || log.shedCode.toLowerCase().includes(q) || log.shedName.toLowerCase().includes(q)) {
        return true;
      }
      return log.items.some((item) => (labels.get(item.code) ?? item.code).toLowerCase().includes(q));
    });
  }, [logs, logQuery, labels]);

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

  // Same shortcut, into the meter-picking flow instead — a utility_operator
  // has no maintenance flow at all (that is not their job), and an
  // admin/super_admin need a way into both since either tier can fill in
  // "whenever the electrician is absent."
  function logMeterAt(shedId?: string) {
    if (shedId) sessionStorage.setItem(METER_PRESELECT_KEY, shedId);
    else sessionStorage.removeItem(METER_PRESELECT_KEY);
    void navigate({ to: '/meter' });
  }

  const showMaintenanceFlow = user?.role !== 'utility_operator';
  const showMeterFlow = user?.role === 'utility_operator' || user?.role === 'admin' || user?.role === 'super_admin';

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

      {showMaintenanceFlow && (
        <>
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
        </>
      )}

      {showMeterFlow && (
        <>
          <h2 className="dash-section-title" style={{ marginTop: showMaintenanceFlow ? 24 : 0 }}>
            {t('home.chooseShedMeterTitle')}
          </h2>
          {sheds.length <= 1 ? (
            <button className="btn btn-amber btn-block record-cta" onClick={() => logMeterAt()}>
              {t('home.meterButton')}
            </button>
          ) : (
            <div className="home-shed-grid">
              {sheds.map((s) => (
                <button key={s.id} className="home-shed-card" onClick={() => logMeterAt(s.id)}>
                  <span className="shed-badge">{s.code}</span>
                  <span className="home-shed-name">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {showMaintenanceFlow && (
        <>
          <h2 className="screen-title" style={{ fontSize: 18, margin: '32px 0 12px' }}>
            {t('home.todayLogsTitle')}
          </h2>

          {logs !== null && logs.length > 0 && (
            <input
              className="input"
              style={{ marginBottom: 12 }}
              placeholder={t('home.searchLogsPlaceholder')}
              value={logQuery}
              onChange={(e) => setLogQuery(e.target.value)}
            />
          )}

          {logs === null && <p className="meta">{t('common.loading')}</p>}
          {logs !== null && logs.length === 0 && <p className="meta">{t('home.noLogsToday')}</p>}
          {logs !== null && logs.length > 0 && filteredLogs?.length === 0 && (
            <p className="meta">{t('home.noLogsMatch', { query: logQuery })}</p>
          )}
          {filteredLogs !== null && filteredLogs !== undefined && filteredLogs.length > 0 && (
            <ul className="stack-list">
              {filteredLogs.map((log) => (
                <LogListItem key={log.id} log={log} labels={labels} lang={lang} />
              ))}
            </ul>
          )}

          <Link to="/history" className="btn btn-block btn-link" style={{ marginTop: 20 }}>
            {t('home.viewFullHistory')}
          </Link>
        </>
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
