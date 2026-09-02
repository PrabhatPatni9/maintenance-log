import { useEffect, useMemo, useState } from 'react';
import { useLang, useT } from '../i18n';
import { RequireAuth } from '../lib/guards';
import { api } from '../lib/api';
import { db } from '../lib/db';
import { LogListItem } from '../components/LogListItem';
import { formatDayHeading, dayKey } from '../lib/format';
import { labelFor } from '@shared/taxonomy';
import type { LogSummary, TaxonomyItemRecord } from '@shared/types';

const PAGE_SIZE = 30;

/**
 * Every day the operator has ever recorded, not just today — the fix for
 * "workers are getting confused" about where an older log went. Home keeps
 * a short today-only glance; this is the persistent, complete record,
 * grouped under a date heading per day (CLAUDE.md section 10: the day and
 * year stay Latin digits, only the month name localises) and paged
 * backward in time so a year of logs never has to load in one request.
 */
function HistoryInner() {
  const t = useT();
  const { lang } = useLang();
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  async function loadPage(before?: number) {
    const qs = before ? `?before=${before}&limit=${PAGE_SIZE}` : `?limit=${PAGE_SIZE}`;
    const { logs: page } = await api.get<{ logs: LogSummary[] }>(`/logs${qs}`);
    setHasMore(page.length === PAGE_SIZE);
    return page;
  }

  useEffect(() => {
    setLoading(true);
    void loadPage()
      .then((page) => setLogs(page))
      .finally(() => setLoading(false));

    void db.taxonomy.toArray().then((items) => {
      setLabels(new Map(items.map((i) => [i.code, labelFor(i as unknown as TaxonomyItemRecord, lang)])));
    });
  }, [lang]);

  async function loadMore() {
    if (logs.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = logs[logs.length - 1]!.clientCreatedAt;
      const page = await loadPage(oldest);
      setLogs((prev) => [...prev, ...page]);
    } finally {
      setLoadingMore(false);
    }
  }

  // Grouped in render order (logs already arrive newest-first), so a group
  // never needs a second sort pass.
  const groups = useMemo(() => {
    const out: { key: string; heading: string; logs: LogSummary[] }[] = [];
    for (const log of logs) {
      const key = dayKey(log.clientCreatedAt);
      const last = out[out.length - 1];
      if (last?.key === key) {
        last.logs.push(log);
      } else {
        out.push({ key, heading: formatDayHeading(log.clientCreatedAt, lang), logs: [log] });
      }
    }
    return out;
  }, [logs, lang]);

  return (
    <div className="screen">
      <h1 className="screen-title" style={{ marginBottom: 20 }}>
        {t('history.title')}
      </h1>

      {loading && <p className="meta">{t('common.loading')}</p>}
      {!loading && logs.length === 0 && <p className="meta">{t('history.empty')}</p>}

      {groups.map((group) => (
        <div key={group.key} style={{ marginBottom: 24 }}>
          <h2 className="history-day-heading">{group.heading}</h2>
          <ul className="stack-list">
            {group.logs.map((log) => (
              <LogListItem key={log.id} log={log} labels={labels} lang={lang} />
            ))}
          </ul>
        </div>
      ))}

      {!loading && hasMore && (
        <button className="btn btn-block" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? t('common.loading') : t('history.loadMore')}
        </button>
      )}
    </div>
  );
}

export function History() {
  return (
    <RequireAuth>
      <HistoryInner />
    </RequireAuth>
  );
}
