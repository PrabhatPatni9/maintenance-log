import { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useT } from '../i18n';
import { RequireAuth, RequireUtilityAccess } from '../lib/guards';
import { api, ApiError } from '../lib/api';
import { todayInAppTz } from '../lib/date';
import type { Meter, MeterReading, Shed } from '@shared/types';

/**
 * "Current reading minus yesterday's reading gives today's consumption" —
 * the electrician only ever has to type in what the meter shows right now.
 * The subtraction happens server side (meter-readings.ts), not here.
 * Today's own row (if already submitted) pre-fills, so correcting a typo
 * minutes later is just retyping and saving again — see meter-readings.ts's
 * POST for why that is safe (same-day upsert, no audit trail needed).
 */
function MeterEntryInner() {
  const t = useT();
  const navigate = useNavigate();
  const { meterId } = useParams({ from: '/meter/$meterId' });

  const [meter, setMeter] = useState<Meter | null>(null);
  const [shed, setShed] = useState<Shed | null>(null);
  const [recent, setRecent] = useState<MeterReading[]>([]);
  const [kwh, setKwh] = useState('');
  const [pf, setPf] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.get<{ meters: Meter[] }>('/meters'),
      api.get<{ sheds: Shed[] }>('/sheds'),
      api.get<{ readings: MeterReading[] }>(`/meter-readings/meter/${meterId}?days=14`),
    ])
      .then(([meters, sheds, readings]) => {
        const m = meters.meters.find((x) => x.id === meterId) ?? null;
        setMeter(m);
        setShed(m ? sheds.sheds.find((s) => s.id === m.shedId) ?? null : null);
        const sorted = [...readings.readings].sort((a, b) => b.readingDate.localeCompare(a.readingDate));
        setRecent(sorted);
        const today = sorted[0];
        const isToday = today && today.readingDate === todayInAppTz();
        if (isToday) {
          setKwh(String(today.kwhReading));
          if (today.pfReading !== null) setPf(String(today.pfReading));
        }
      })
      .finally(() => setLoading(false));
  }, [meterId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const kwhReading = Number(kwh);
    if (!kwh || Number.isNaN(kwhReading)) {
      setError(t('meters.kwhRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/meter-readings', {
        meterId,
        kwhReading,
        pfReading: pf ? Number(pf) : null,
        note: note.trim() || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('meters.saveError'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="meta" style={{ padding: 20 }}>{t('common.loading')}</p>;
  if (!meter) return <p className="meta" style={{ padding: 20 }}>{t('meters.notFound')}</p>;

  if (saved) {
    return (
      <div className="screen">
        <h1 className="screen-title" style={{ marginBottom: 12 }}>
          {t('meters.savedTitle')}
        </h1>
        <p className="meta" style={{ marginBottom: 24 }}>
          {meter.code} · {shed?.name} · {kwh} {t('meters.kwhUnit')}
        </p>
        <button className="btn btn-primary btn-block" onClick={() => void navigate({ to: '/' })}>
          {t('common.done')}
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ marginBottom: 4 }}>
        {meter.code}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {shed?.name} · {new Date().toLocaleDateString()}
      </p>

      <form onSubmit={save} className="panel stacked-form" style={{ marginBottom: 24 }}>
        <div>
          <label className="field-label">{t('meters.kwhLabel')}</label>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={kwh}
            onChange={(e) => setKwh(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="field-label">{t('meters.pfLabel')}</label>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="1"
            value={pf}
            onChange={(e) => setPf(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">{t('meters.noteLabel')}</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--fault)', margin: 0 }}>{error}</p>}
        <button className="btn btn-amber btn-block" type="submit" disabled={busy} style={{ minHeight: 60, fontSize: 18 }}>
          {t('meters.saveButton')}
        </button>
      </form>

      {recent.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('meters.recentTitle')}</h2>
          <ul className="stack-list">
            {recent.map((r) => (
              <li key={r.id} className="panel" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
                <span className="meta">{r.readingDate}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {r.kwhReading} {t('meters.kwhUnit')}
                  {r.pfReading !== null ? ` · ${t('meters.pfUnit')} ${r.pfReading}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function MeterEntry() {
  return (
    <RequireAuth>
      <RequireUtilityAccess>
        <MeterEntryInner />
      </RequireUtilityAccess>
    </RequireAuth>
  );
}
