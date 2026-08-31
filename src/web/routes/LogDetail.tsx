import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useLang, useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import { db } from '../lib/db';
import { labelFor } from '@shared/taxonomy';
import type { LogDetail as LogDetailType, TaxonomyItemRecord } from '@shared/types';

function LogDetailInner() {
  const t = useT();
  const { lang } = useLang();
  const { logId } = useParams({ from: '/logs/$logId' });
  const [log, setLog] = useState<LogDetailType | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void api.get<{ log: LogDetailType }>(`/logs/${logId}`).then((r) => setLog(r.log));
    void db.taxonomy.toArray().then((items) => {
      setLabels(new Map(items.map((i) => [i.code, labelFor(i as unknown as TaxonomyItemRecord, lang)])));
    });
  }, [logId, lang]);

  if (!log) return <p className="meta" style={{ padding: 20 }}>{t('common.loading')}</p>;

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ marginBottom: 4 }}>
        {t('logDetail.title')}
      </h1>
      <p className="meta" style={{ marginBottom: 20 }}>
        {log.machineNo} · {log.shedName} · {new Date(log.clientCreatedAt).toLocaleString()} · {log.operatorName}
      </p>

      {log.edits.length > 0 && (
        <div className="panel" style={{ padding: 12, marginBottom: 16, borderColor: 'var(--queue)' }}>
          <strong style={{ color: 'var(--queue)' }}>{t('logDetail.editedBadge')}</strong>
          {log.edits.map((e) => (
            <p key={e.id} className="meta" style={{ marginTop: 4 }}>
              {new Date(e.editedAt).toLocaleString()} — {e.adminPhone}: {e.reason}
            </p>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('segment.transcriptLabel')}</h2>
      <p className="panel" style={{ padding: 12, marginBottom: 20 }}>
        {log.transcript || log.typedNote || '—'}
      </p>

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('review.itemsLabel')}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        {log.items.map((item) => (
          <span
            key={item.id}
            style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', padding: '0 16px', borderRadius: 999, background: 'var(--ink)', color: 'var(--panel)' }}
          >
            {labels.get(item.code) ?? item.code}
          </span>
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--steel)', marginBottom: 8 }}>{t('logDetail.segmentsLabel')}</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {log.segments.map((seg) => (
          <li key={seg.id} className="panel" style={{ padding: 12, marginBottom: 8 }}>
            <p className="meta">
              #{seg.seq + 1} · {seg.source} · {seg.durationMs ? Math.round(seg.durationMs / 1000) : '?'}s
            </p>
            <p>{seg.transcript || '—'}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LogDetail() {
  return (
    <RequireAuth>
      <LogDetailInner />
    </RequireAuth>
  );
}
