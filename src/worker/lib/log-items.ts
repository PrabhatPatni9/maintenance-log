import { mapItem } from './mappers';
import type { LogItemRecord } from '@shared/types';

/** One batched query instead of one-per-log — the shape both the machine
 * history screen and the home log list need: every log_item, grouped back
 * onto the log it belongs to. */
export async function itemsByLogId(
  db: D1Database,
  logIds: string[],
): Promise<Map<string, LogItemRecord[]>> {
  const byLog = new Map<string, LogItemRecord[]>();
  if (logIds.length === 0) return byLog;

  const placeholders = logIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM log_items WHERE log_id IN (${placeholders})`)
    .bind(...logIds)
    .all<Record<string, unknown>>();

  for (const r of results) {
    const item = mapItem(r);
    const list = byLog.get(item.logId) ?? [];
    list.push(item);
    byLog.set(item.logId, list);
  }
  return byLog;
}
