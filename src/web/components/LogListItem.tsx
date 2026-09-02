import { Link } from '@tanstack/react-router';
import { useT } from '../i18n';
import { formatClockTime } from '../lib/format';
import type { Lang, LogSummary } from '@shared/types';

/**
 * One row in a log list — Home's "today" section and the History screen's
 * day groups both render logs this way, so a log looks the same wherever an
 * operator finds it. Machine/shed line and pills are what turn a bare
 * transcript into something recognisable at a glance.
 */
export function LogListItem({ log, labels, lang }: { log: LogSummary; labels: Map<string, string>; lang: Lang }) {
  const t = useT();
  const text = log.transcript?.trim() || log.typedNote?.trim() || '';

  return (
    <li className="panel">
      <Link to="/logs/$logId" params={{ logId: log.id }} className="record-link">
        <div className="record-time">{formatClockTime(log.clientCreatedAt, lang)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="meta" style={{ marginBottom: 2 }}>
            {log.machineNo} · {log.shedCode}
          </div>
          <div className="record-text">{text || t('capture.savedOffline')}</div>
          {log.items.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {log.items.map((item) => (
                <span key={item.id} className="history-pill">
                  {labels.get(item.code) ?? item.code}
                </span>
              ))}
            </div>
          )}
          <div className="meta" style={{ marginTop: 4 }}>
            {log.status === 'approved' ? t('review.approved') : log.status}
          </div>
        </div>
      </Link>
    </li>
  );
}
