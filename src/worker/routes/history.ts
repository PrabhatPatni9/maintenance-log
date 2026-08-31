import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { buildHistoryExportQuery, buildHistoryQuery, type HistoryFilters } from '../lib/history-query';
import { toCsv } from '../lib/csv';
import { uuidv7 } from '@shared/id';

export const historyRoutes = new Hono<AppEnv>();
historyRoutes.use('*', requireAuth, requireAdmin);

function filtersFromQuery(c: { req: { query(name: string): string | undefined } }): HistoryFilters {
  return {
    shedId: c.req.query('shedId') || undefined,
    machineId: c.req.query('machineId') || undefined,
    operatorPhone: c.req.query('operatorPhone') || undefined,
    dateFrom: c.req.query('dateFrom') ? Number(c.req.query('dateFrom')) : undefined,
    dateTo: c.req.query('dateTo') ? Number(c.req.query('dateTo')) : undefined,
    code: c.req.query('code') || undefined,
  };
}

const PAGE_SIZE = 50;

historyRoutes.get('/', async (c) => {
  const filters = filtersFromQuery(c);
  const page = Number(c.req.query('page') ?? 0);

  const { sql, binds } = buildHistoryQuery(filters, { page, pageSize: PAGE_SIZE });
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();

  return c.json({ rows: results, page, pageSize: PAGE_SIZE });
});

historyRoutes.get('/export.csv', async (c) => {
  const filters = filtersFromQuery(c);
  const { sql, binds } = buildHistoryExportQuery(filters);
  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();

  const headers = [
    'log_id',
    'date',
    'shed_code',
    'shed_name',
    'machine_no',
    'operator_name',
    'operator_phone',
    'item_code',
    'item_label_en',
    'category',
    'qty',
    'unit',
    'origin',
    'transcript',
  ];
  const rows = results.map((r) => [
    r.log_id,
    new Date(r.client_created_at as number).toISOString(),
    r.shed_code,
    r.shed_name,
    r.machine_no,
    r.operator_name,
    r.operator_phone,
    r.item_code,
    r.label_en,
    r.category,
    r.qty,
    r.unit,
    r.origin,
    r.transcript,
  ]);

  return new Response(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ratanmoti-maintenance-history.csv"',
    },
  });
});

/**
 * Admin edit on an approved (immutable) log. Never overwrites — every change
 * appends a row to log_edits with the before/after and a required reason
 * (CLAUDE.md section 2.4, section 5).
 */
historyRoutes.patch('/logs/:id', async (c) => {
  const logId = c.req.param('id');
  const session = c.get('session');
  const body = await c.req.json<{
    field: 'transcript' | 'items';
    valueAfter: string;
    reason: string;
  }>();

  if (!body.reason?.trim()) return c.json({ error: 'reason required' }, 400);

  const log = await c.env.DB.prepare('SELECT * FROM logs WHERE id = ?')
    .bind(logId)
    .first<Record<string, unknown>>();
  if (!log) return c.json({ error: 'not found' }, 404);

  let valueBefore: string;

  if (body.field === 'transcript') {
    valueBefore = (log.transcript as string) ?? '';
    await c.env.DB.prepare('UPDATE logs SET transcript = ? WHERE id = ?')
      .bind(body.valueAfter, logId)
      .run();
  } else {
    const { results: items } = await c.env.DB.prepare(
      'SELECT code, qty, unit, origin FROM log_items WHERE log_id = ?',
    )
      .bind(logId)
      .all<Record<string, unknown>>();
    valueBefore = JSON.stringify(items);

    const newItems = JSON.parse(body.valueAfter) as {
      code: string;
      qty: number | null;
      unit: string | null;
    }[];
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM log_items WHERE log_id = ?').bind(logId),
      ...newItems.map((item) =>
        c.env.DB.prepare(
          'INSERT INTO log_items (id, log_id, code, qty, unit, origin) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(uuidv7(), logId, item.code, item.qty, item.unit, 'manual'),
      ),
    ]);
  }

  await c.env.DB.prepare(
    `INSERT INTO log_edits (id, log_id, admin_phone, field, value_before, value_after, reason, edited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(uuidv7(), logId, session.phone, body.field, valueBefore, body.valueAfter, body.reason, Date.now())
    .run();

  return c.json({ ok: true });
});
