import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAuth, requireSuperAdmin } from '../lib/middleware';

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use('*', requireAuth, requireSuperAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Owner-tier overview: what is happening across every shed, no scoping.
 * Every query excludes deleted_at (a purged/soft-deleted log is not
 * "activity" any more) and only counts approved logs (a draft mid-sync is
 * not a fact about the plant yet). Several independent aggregates rather
 * than one mega-query, because each one answers a different question and
 * none of them need each other's rows.
 */
dashboardRoutes.get('/', async (c) => {
  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const [summary, topMachines, topActions, operators, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM logs WHERE status='approved' AND deleted_at IS NULL AND client_created_at >= ?) AS logs_today,
        (SELECT COUNT(*) FROM logs WHERE status='approved' AND deleted_at IS NULL AND client_created_at >= ?) AS logs_week,
        (SELECT COUNT(*) FROM logs WHERE status='approved' AND deleted_at IS NULL) AS logs_total,
        (SELECT COUNT(DISTINCT operator_phone) FROM logs WHERE status='approved' AND deleted_at IS NULL AND client_created_at >= ?) AS active_operators,
        (SELECT COUNT(*) FROM sheds WHERE active=1) AS active_sheds,
        (SELECT COUNT(*) FROM machines WHERE active=1) AS active_machines`,
    ).bind(todayStart.getTime(), weekAgo, monthAgo),

    c.env.DB.prepare(
      `SELECT mc.id AS machine_id, mc.machine_no, s.code AS shed_code, s.name AS shed_name,
              COUNT(*) AS visits, MAX(l.client_created_at) AS last_visit
       FROM logs l
       JOIN machines mc ON mc.id = l.machine_id
       JOIN sheds s ON s.id = mc.shed_id
       WHERE l.status='approved' AND l.deleted_at IS NULL
       GROUP BY mc.id
       ORDER BY visits DESC, last_visit DESC
       LIMIT 10`,
    ),

    c.env.DB.prepare(
      `SELECT li.code, ti.label_en, ti.label_hi, ti.label_mr, ti.kind, COUNT(*) AS uses
       FROM log_items li
       JOIN logs l ON l.id = li.log_id
       JOIN taxonomy_items ti ON ti.code = li.code
       WHERE l.status='approved' AND l.deleted_at IS NULL
       GROUP BY li.code
       ORDER BY uses DESC
       LIMIT 10`,
    ),

    c.env.DB.prepare(
      `SELECT u.phone, u.name, COUNT(DISTINCT l.id) AS log_count,
              COUNT(DISTINCT l.machine_id) AS machine_count,
              MAX(l.client_created_at) AS last_active
       FROM logs l
       JOIN users u ON u.phone = l.operator_phone
       WHERE l.status='approved' AND l.deleted_at IS NULL
       GROUP BY u.phone
       ORDER BY log_count DESC
       LIMIT 20`,
    ),

    c.env.DB.prepare(
      `SELECT l.id, l.client_created_at, l.transcript, l.typed_note,
              u.name AS operator_name, s.code AS shed_code, mc.machine_no,
              (SELECT GROUP_CONCAT(ti.label_en, ', ') FROM log_items li
               JOIN taxonomy_items ti ON ti.code = li.code WHERE li.log_id = l.id) AS items
       FROM logs l
       JOIN machines mc ON mc.id = l.machine_id
       JOIN sheds s ON s.id = mc.shed_id
       JOIN users u ON u.phone = l.operator_phone
       WHERE l.status='approved' AND l.deleted_at IS NULL
       ORDER BY l.client_created_at DESC
       LIMIT 20`,
    ),
  ]);

  const s = summary!.results[0] as Record<string, number>;
  const rows = (list: typeof topMachines) => list!.results as Record<string, unknown>[];

  return c.json({
    summary: {
      logsToday: s.logs_today,
      logsWeek: s.logs_week,
      logsTotal: s.logs_total,
      activeOperators: s.active_operators,
      activeSheds: s.active_sheds,
      activeMachines: s.active_machines,
    },
    topMachines: rows(topMachines).map((r) => ({
      machineId: r.machine_id,
      machineNo: r.machine_no,
      shedCode: r.shed_code,
      shedName: r.shed_name,
      visits: r.visits,
      lastVisit: r.last_visit,
    })),
    topActions: rows(topActions).map((r) => ({
      code: r.code,
      labelEn: r.label_en,
      labelHi: r.label_hi,
      labelMr: r.label_mr,
      kind: r.kind,
      uses: r.uses,
    })),
    operators: rows(operators).map((r) => ({
      phone: r.phone,
      name: r.name,
      logCount: r.log_count,
      machineCount: r.machine_count,
      lastActive: r.last_active,
    })),
    recent: rows(recent).map((r) => ({
      id: r.id,
      clientCreatedAt: r.client_created_at,
      text: (r.transcript as string) || (r.typed_note as string) || '',
      operatorName: r.operator_name,
      shedCode: r.shed_code,
      machineNo: r.machine_no,
      items: r.items ? String(r.items).split(', ') : [],
    })),
  });
});

/**
 * Per-machine breakdown: every distinct action/part logged against this one
 * machine, with counts — "which machines have what done" at the level of a
 * single loom, drilled into from the dashboard's top-machines list.
 */
dashboardRoutes.get('/machines/:id', async (c) => {
  const machineId = c.req.param('id');

  const { results } = await c.env.DB.prepare(
    `SELECT li.code, ti.label_en, ti.label_hi, ti.label_mr, ti.kind, COUNT(*) AS uses,
            MAX(l.client_created_at) AS last_done
     FROM log_items li
     JOIN logs l ON l.id = li.log_id
     WHERE l.machine_id = ? AND l.status='approved' AND l.deleted_at IS NULL
     GROUP BY li.code
     ORDER BY uses DESC`,
  )
    .bind(machineId)
    .all<Record<string, unknown>>();

  return c.json({
    items: results.map((r) => ({
      code: r.code,
      labelEn: r.label_en,
      labelHi: r.label_hi,
      labelMr: r.label_mr,
      kind: r.kind,
      uses: r.uses,
      lastDone: r.last_done,
    })),
  });
});
