import { useEffect, useState } from 'react';
import { useLang, useT } from '../../i18n';
import { useAuth } from '../../lib/auth-context';
import { RequireSuperAdmin } from '../../lib/guards';
import { api } from '../../lib/api';

interface DashboardData {
  summary: {
    logsToday: number;
    logsWeek: number;
    logsTotal: number;
    activeOperators: number;
    activeSheds: number;
    activeMachines: number;
  };
  topMachines: {
    machineId: string;
    machineNo: string;
    shedCode: string;
    shedName: string;
    visits: number;
    lastVisit: number;
  }[];
  topActions: {
    code: string;
    labelEn: string;
    labelHi: string;
    labelMr: string;
    kind: 'action' | 'part';
    uses: number;
  }[];
  operators: {
    phone: string;
    name: string;
    logCount: number;
    machineCount: number;
    lastActive: number;
  }[];
  recent: {
    id: string;
    clientCreatedAt: number;
    text: string;
    operatorName: string;
    shedCode: string;
    machineNo: string;
    items: string[];
  }[];
}

interface MachineHistory {
  items: {
    code: string;
    labelEn: string;
    labelHi: string;
    labelMr: string;
    kind: 'action' | 'part';
    uses: number;
    lastDone: number;
  }[];
}

function labelFor(item: { labelEn: string; labelHi: string; labelMr: string }, lang: string): string {
  if (lang === 'hi') return item.labelHi;
  if (lang === 'mr') return item.labelMr;
  return item.labelEn;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-value">{value}</div>
      <div className="meta">{label}</div>
    </div>
  );
}

function DashboardInner() {
  const t = useT();
  const { lang } = useLang();
  const [data, setData] = useState<DashboardData | null>(null);
  const [drilldown, setDrilldown] = useState<{ machineNo: string; shedCode: string; id: string } | null>(null);
  const [history, setHistory] = useState<MachineHistory | null>(null);

  useEffect(() => {
    void api.get<DashboardData>('/admin/dashboard').then(setData);
  }, []);

  useEffect(() => {
    if (!drilldown) {
      setHistory(null);
      return;
    }
    void api.get<MachineHistory>(`/admin/dashboard/machines/${drilldown.id}`).then(setHistory);
  }, [drilldown]);

  if (!data) return <p className="meta">{t('common.loading')}</p>;
  const { summary } = data;

  return (
    <div>
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('admin.dashboard.title')}
      </h1>

      <div className="stat-grid">
        <Stat value={summary.logsToday} label={t('admin.dashboard.logsToday')} />
        <Stat value={summary.logsWeek} label={t('admin.dashboard.logsWeek')} />
        <Stat value={summary.logsTotal} label={t('admin.dashboard.logsTotal')} />
        <Stat value={summary.activeOperators} label={t('admin.dashboard.activeOperators')} />
        <Stat value={summary.activeSheds} label={t('admin.dashboard.activeSheds')} />
        <Stat value={summary.activeMachines} label={t('admin.dashboard.activeMachines')} />
      </div>

      <h2 className="dash-section-title">{t('admin.dashboard.topMachinesTitle')}</h2>
      {data.topMachines.length === 0 && <p className="meta">{t('admin.dashboard.noData')}</p>}
      <ul className="stack-list">
        {data.topMachines.map((m) => (
          <li key={m.machineId} className="panel dash-row">
            <div className="shed-badge" style={{ minWidth: 32, height: 32, fontSize: 14 }}>
              {m.shedCode}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{m.machineNo}</div>
              <div className="meta">
                {m.visits} {t('admin.dashboard.visits')} · {new Date(m.lastVisit).toLocaleDateString()}
              </div>
            </div>
            <button
              className="btn btn-small"
              onClick={() => setDrilldown({ machineNo: m.machineNo, shedCode: m.shedCode, id: m.machineId })}
            >
              {t('admin.dashboard.viewMachine')}
            </button>
          </li>
        ))}
      </ul>

      {drilldown && (
        <div className="dash-drilldown">
          <div className="dash-drilldown-head">
            <strong>
              {drilldown.shedCode} {drilldown.machineNo}
            </strong>
            <button className="btn btn-small" onClick={() => setDrilldown(null)}>
              {t('common.close')}
            </button>
          </div>
          <p className="meta" style={{ marginBottom: 10 }}>
            {t('admin.dashboard.machineHistoryTitle')}
          </p>
          {!history && <p className="meta">{t('common.loading')}</p>}
          {history && history.items.length === 0 && <p className="meta">{t('admin.dashboard.noData')}</p>}
          {history && (
            <ul className="stack-list">
              {history.items.map((it) => (
                <li key={it.code} className="panel" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{labelFor(it, lang)}</span>
                  <span className="meta">
                    {it.uses}× · {new Date(it.lastDone).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h2 className="dash-section-title">{t('admin.dashboard.topActionsTitle')}</h2>
      {data.topActions.length === 0 && <p className="meta">{t('admin.dashboard.noData')}</p>}
      <div className="dash-chip-row">
        {data.topActions.map((a) => (
          <span key={a.code} className="dash-chip">
            {labelFor(a, lang)} <strong>{a.uses}</strong>
          </span>
        ))}
      </div>

      <h2 className="dash-section-title">{t('admin.dashboard.operatorsTitle')}</h2>
      {data.operators.length === 0 && <p className="meta">{t('admin.dashboard.noData')}</p>}
      <ul className="stack-list">
        {data.operators.map((op) => (
          <li key={op.phone} className="panel dash-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{op.name}</div>
              <div className="meta">
                {op.logCount} {t('admin.dashboard.logs')} · {op.machineCount} {t('admin.dashboard.machines')} ·{' '}
                {t('admin.dashboard.lastActive')}: {new Date(op.lastActive).toLocaleDateString()}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="dash-section-title">{t('admin.dashboard.recentTitle')}</h2>
      {data.recent.length === 0 && <p className="meta">{t('admin.dashboard.noData')}</p>}
      <ul className="stack-list">
        {data.recent.map((r) => (
          <li key={r.id} className="panel" style={{ padding: '10px 14px' }}>
            <div className="meta">
              {r.shedCode} {r.machineNo} · {r.operatorName} · {new Date(r.clientCreatedAt).toLocaleString()}
            </div>
            <div style={{ marginTop: 4 }}>{r.text.slice(0, 140) || (r.items.length ? r.items.join(', ') : '—')}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  return (
    <RequireSuperAdmin>
      {user && <DashboardInner />}
    </RequireSuperAdmin>
  );
}
