import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useLang, useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import { db } from '../lib/db';
import { labelFor } from '@shared/taxonomy';
import type { MachineHistoryResponse, TaxonomyItemRecord } from '@shared/types';

const HISTORY_DAYS = 14;

/**
 * Shed picked, machine picked — this is what "select the shed, select the
 * machine" was building up to: everything done on this exact loom in the
 * last two weeks, by whoever did it, before the operator ever opens the mic.
 * Record stays reachable the whole time via the footer, unchanged — this
 * screen only moves where that button lives, not what it does.
 */
function MachineHistoryInner() {
  const t = useT();
  const { lang } = useLang();
  const { machineId } = useParams({ from: '/machine/$machineId' });
  const navigate = useNavigate();
  const [data, setData] = useState<MachineHistoryResponse | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void api
      .get<MachineHistoryResponse>(`/machines/${machineId}/history?days=${HISTORY_DAYS}`)
      .then(setData)
      .catch(() => setData(null));
    void db.taxonomy.toArray().then((items) => {
      setLabels(new Map(items.map((i) => [i.code, labelFor(i as unknown as TaxonomyItemRecord, lang)])));
    });
  }, [machineId, lang]);

  return (
    <div className="machine-history-screen">
      <div className="machine-history-body">
        {!data ? (
          <p className="meta" style={{ padding: 20 }}>
            {t('common.loading')}
          </p>
        ) : (
          <>
            <h1 className="screen-title" style={{ marginBottom: 4 }}>
              {data.machine.machineNo}
            </h1>
            <p className="meta" style={{ marginBottom: 20 }}>
              {t('machineHistory.rangeLabel', { days: String(data.days) })}
            </p>

            {data.logs.length === 0 && <p className="meta">{t('machineHistory.empty', { days: String(data.days) })}</p>}

            <ul className="stack-list">
              {data.logs.map((log) => (
                <li key={log.id} className="panel" style={{ padding: 14 }}>
                  <Link to="/logs/$logId" params={{ logId: log.id }} className="record-link" style={{ display: 'block' }}>
                    <div className="meta" style={{ marginBottom: 6 }}>
                      {new Date(log.clientCreatedAt).toLocaleString()} · {log.operatorName}
                    </div>
                    <p style={{ marginBottom: log.items.length > 0 ? 10 : 0 }}>
                      {log.transcript || log.typedNote || t('capture.savedOffline')}
                    </p>
                    {log.items.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {log.items.map((item) => (
                          <span key={item.id} className="history-pill">
                            {labels.get(item.code) ?? item.code}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Persistent footer: the record flow itself is unchanged, this is
          just where the door to it lives now — after the history, not
          before it. */}
      <div className="machine-history-foot">
        <button
          className="btn btn-amber btn-block"
          style={{ minHeight: 60, fontSize: 18 }}
          onClick={() => void navigate({ to: '/record/$machineId', params: { machineId } })}
        >
          {t('machineHistory.recordButton')}
        </button>
      </div>
    </div>
  );
}

export function MachineHistory() {
  return (
    <RequireAuth>
      <MachineHistoryInner />
    </RequireAuth>
  );
}
