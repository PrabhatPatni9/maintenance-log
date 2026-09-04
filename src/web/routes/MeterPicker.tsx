import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useT } from '../i18n';
import { RequireAuth, RequireUtilityAccess } from '../lib/guards';
import { api } from '../lib/api';
import type { Meter, Shed } from '@shared/types';

/**
 * Same two-step shape as MachinePicker (pick the shed, skipped if there is
 * only one; then pick from that shed's list) — the electrician's job is a
 * different flow from the operator's, but the muscle memory should feel
 * the same. Fetched live rather than cached in Dexie: meter entry is a
 * small, occasional daily task, not the offline-first recording flow
 * CLAUDE.md's non-negotiables are about.
 */
function MeterPickerInner() {
  const t = useT();
  const navigate = useNavigate();
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedShedId, setSelectedShedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([api.get<{ sheds: Shed[] }>('/sheds'), api.get<{ meters: Meter[] }>('/meters')])
      .then(([s, m]) => {
        setSheds(s.sheds);
        setMeters(m.meters);
        const preselected = sessionStorage.getItem('preselectedMeterShedId');
        sessionStorage.removeItem('preselectedMeterShedId');
        if (preselected && s.sheds.some((sh) => sh.id === preselected)) {
          setSelectedShedId(preselected);
        } else if (s.sheds.length === 1) {
          setSelectedShedId(s.sheds[0]!.id);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const metersInShed = meters.filter((m) => m.shedId === selectedShedId && m.active);
  const selectedShed = sheds.find((s) => s.id === selectedShedId);

  if (loading) return <p className="meta" style={{ padding: 20 }}>{t('common.loading')}</p>;

  if (!selectedShedId) {
    return (
      <div className="screen">
        <h1 className="screen-title" style={{ marginBottom: 20 }}>
          {t('machine.pickShedTitle')}
        </h1>
        {sheds.length === 0 && <p className="meta">{t('machine.noSheds')}</p>}
        <ul className="stack-list">
          {sheds.map((s) => (
            <li key={s.id}>
              <button className="btn btn-block shed-choice" onClick={() => setSelectedShedId(s.id)}>
                <span className="shed-choice-code">{s.code}</span>
                <span>{s.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">
          {selectedShed ? `${selectedShed.code} — ${selectedShed.name}` : t('meters.pickerTitle')}
        </h1>
        {sheds.length > 1 && (
          <button className="btn btn-small" onClick={() => setSelectedShedId(null)}>
            {t('common.back')}
          </button>
        )}
      </div>

      {metersInShed.length === 0 && <p className="meta">{t('meters.noMeters')}</p>}

      <ul className="stack-list">
        {metersInShed.map((m) => (
          <li key={m.id}>
            <button
              className="btn btn-block shed-choice"
              onClick={() => void navigate({ to: '/meter/$meterId', params: { meterId: m.id } })}
            >
              <span className="shed-choice-code">{m.code}</span>
              <span>{m.name || m.code}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MeterPicker() {
  return (
    <RequireAuth>
      <RequireUtilityAccess>
        <MeterPickerInner />
      </RequireUtilityAccess>
    </RequireAuth>
  );
}
