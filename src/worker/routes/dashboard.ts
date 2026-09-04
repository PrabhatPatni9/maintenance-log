import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { accessibleShedIds, canAccessShed } from '../lib/shed-access';

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use('*', requireAuth, requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Empty clause + no binds for the owner tier (every shed, no filter). For
 * a shed-scoped admin, an `alias.shed_id IN (...)` (or `alias.id IN (...)`
 * when the aliased table is sheds itself) restricting every query in this
 * file to exactly the sheds they were granted — the dashboard is now
 * "managerial" for an admin (CLAUDE.md-adjacent: shed-level access, same
 * scoping as everywhere else), not owner-tier-only. */
function shedFilter(column: string, allowed: string[] | 'all'): { clause: string; binds: unknown[] } {
  if (allowed === 'all') return { clause: '', binds: [] };
  if (allowed.length === 0) return { clause: `AND 0=1`, binds: [] };
  return { clause: `AND ${column} IN (${allowed.map(() => '?').join(',')})`, binds: allowed };
}

/**
 * Shed-scoped for an admin, unscoped for the owner tier: what is happening
 * across the sheds this caller can actually see. Every query excludes
 * deleted_at (a purged/soft-deleted log is not "activity" any more) and
 * only counts approved logs (a draft mid-sync is not a fact about the plant
 * yet). Several independent aggregates rather than one mega-query, because
 * each one answers a different question and none of them need each other's
 * rows.
 */
dashboardRoutes.get('/', async (c) => {
  const session = c.get('session');
  const allowed = await accessibleShedIds(c.env.DB, session);

  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const shedF = shedFilter('shed_id', allowed); // for subqueries against machines directly
  const mcF = shedFilter('mc.shed_id', allowed); // for queries joined out to machines as `mc`
  const sF = shedFilter('s.id', allowed); // for queries joined out to sheds as `s`

  const [summary, topMachines, topActions, operators, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM logs l JOIN machines mc ON mc.id = l.machine_id
          WHERE l.status='approved' AND l.deleted_at IS NULL AND l.client_created_at >= ? ${mcF.clause}) AS logs_today,
        (SELECT COUNT(*) FROM logs l JOIN machines mc ON mc.id = l.machine_id
          WHERE l.status='approved' AND l.deleted_at IS NULL AND l.client_created_at >= ? ${mcF.clause}) AS logs_week,
        (SELECT COUNT(*) FROM logs l JOIN machines mc ON mc.id = l.machine_id
          WHERE l.status='approved' AND l.deleted_at IS NULL ${mcF.clause}) AS logs_total,
        (SELECT COUNT(DISTINCT l.operator_phone) FROM logs l JOIN machines mc ON mc.id = l.machine_id
          WHERE l.status='approved' AND l.deleted_at IS NULL AND l.client_created_at >= ? ${mcF.clause}) AS active_operators,
        (SELECT COUNT(*) FROM sheds s WHERE s.active=1 ${sF.clause}) AS active_sheds,
        (SELECT COUNT(*) FROM machines WHERE active=1 ${shedF.clause}) AS active_machines`,
    ).bind(
      todayStart.getTime(),
      ...mcF.binds,
      weekAgo,
      ...mcF.binds,
      ...mcF.binds,
      monthAgo,
      ...mcF.binds,
      ...sF.binds,
      ...shedF.binds,
    ),

    c.env.DB.prepare(
      `SELECT mc.id AS machine_id, mc.machine_no, s.code AS shed_code, s.name AS shed_name,
              COUNT(*) AS visits, MAX(l.client_created_at) AS last_visit
       FROM logs l
       JOIN machines mc ON mc.id = l.machine_id
       JOIN sheds s ON s.id = mc.shed_id
       WHERE l.status='approved' AND l.deleted_at IS NULL ${sF.clause}
       GROUP BY mc.id
       ORDER BY visits DESC, last_visit DESC
       LIMIT 10`,
    ).bind(...sF.binds),

    c.env.DB.prepare(
      `SELECT li.code, ti.label_en, ti.label_hi, ti.label_mr, ti.kind, COUNT(*) AS uses
       FROM log_items li
       JOIN logs l ON l.id = li.log_id
       JOIN machines mc ON mc.id = l.machine_id
       JOIN taxonomy_items ti ON ti.code = li.code
       WHERE l.status='approved' AND l.deleted_at IS NULL ${mcF.clause}
       GROUP BY li.code
       ORDER BY uses DESC
       LIMIT 10`,
    ).bind(...mcF.binds),

    c.env.DB.prepare(
      `SELECT u.phone, u.name, COUNT(DISTINCT l.id) AS log_count,
              COUNT(DISTINCT l.machine_id) AS machine_count,
              MAX(l.client_created_at) AS last_active
       FROM logs l
       JOIN machines mc ON mc.id = l.machine_id
       JOIN users u ON u.phone = l.operator_phone
       WHERE l.status='approved' AND l.deleted_at IS NULL ${mcF.clause}
       GROUP BY u.phone
       ORDER BY log_count DESC
       LIMIT 20`,
    ).bind(...mcF.binds),

    c.env.DB.prepare(
      `SELECT l.id, l.client_created_at, l.transcript, l.typed_note,
              u.name AS operator_name, s.code AS shed_code, mc.machine_no,
              (SELECT GROUP_CONCAT(ti.label_en, ', ') FROM log_items li
               JOIN taxonomy_items ti ON ti.code = li.code WHERE li.log_id = l.id) AS items
       FROM logs l
       JOIN machines mc ON mc.id = l.machine_id
       JOIN sheds s ON s.id = mc.shed_id
       JOIN users u ON u.phone = l.operator_phone
       WHERE l.status='approved' AND l.deleted_at IS NULL ${sF.clause}
       ORDER BY l.client_created_at DESC
       LIMIT 20`,
    ).bind(...sF.binds),
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
  const session = c.get('session');

  const machine = await c.env.DB.prepare('SELECT shed_id FROM machines WHERE id = ?')
    .bind(machineId)
    .first<{ shed_id: string }>();
  if (!machine) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, machine.shed_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

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
