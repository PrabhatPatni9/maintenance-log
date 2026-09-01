import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireSuperAdmin, requireAuth } from '../lib/middleware';
import { mapShed } from '../lib/mappers';
import { accessibleShedIds, canAccessShed } from '../lib/shed-access';
import { uuidv7 } from '@shared/id';

export const shedRoutes = new Hono<AppEnv>();
shedRoutes.use('*', requireAuth);

/** An operator only ever sees the sheds an admin granted them — never the
 * whole plant. Admins see everything, always. */
shedRoutes.get('/', async (c) => {
  const session = c.get('session');
  const allowed = await accessibleShedIds(c.env.DB, session);

  if (allowed === 'all') {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM sheds ORDER BY code',
    ).all<Record<string, unknown>>();
    return c.json({ sheds: results.map(mapShed) });
  }

  if (allowed.length === 0) return c.json({ sheds: [] });

  const placeholders = allowed.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM sheds WHERE id IN (${placeholders}) AND active = 1 ORDER BY code`,
  )
    .bind(...allowed)
    .all<Record<string, unknown>>();
  return c.json({ sheds: results.map(mapShed) });
});

/** The quick half of "Shed A: how many machines have I worked on" — the
 * same answer the shed → machine → history click-through gives, just
 * without the clicking. Scoped to the calling operator's own approved
 * logs, same as the home screen's "today" list. */
shedRoutes.get('/:id/stats', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  if (!(await canAccessShed(c.env.DB, session, id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const row = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT machine_id) AS machines, COUNT(*) AS logs
     FROM logs
     WHERE operator_phone = ? AND status = 'approved' AND deleted_at IS NULL
       AND machine_id IN (SELECT id FROM machines WHERE shed_id = ?)`,
  )
    .bind(session.phone, id)
    .first<{ machines: number; logs: number }>();

  return c.json({ machinesWorkedOn: row?.machines ?? 0, logCount: row?.logs ?? 0 });
});

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

shedRoutes.post('/', requireSuperAdmin, async (c) => {
  const { code, name } = await c.req.json<{ code: string; name: string }>();
  if (!code || !name) return c.json({ error: 'code and name required' }, 400);

  const id = uuidv7();
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      'INSERT INTO sheds (id, code, name, active, created_at) VALUES (?, ?, ?, 1, ?)',
    )
      .bind(id, code, name, now)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: 'that code is already in use' }, 409);
    throw err;
  }

  return c.json({ shed: { id, code, name, active: true, createdAt: now } }, 201);
});

/**
 * Code and name are both editable, not just name — a supervisor mis-typing
 * a shed code at setup time (or wanting to rename it as the floor's own
 * labelling changes) previously had no way to fix it short of delete and
 * recreate, which would have orphaned every machine and log under it.
 *
 * Renaming the code does not touch R2: audio keys already written
 * (`audio/{shed_code}/...`, CLAUDE.md section 12) keep whatever code was
 * current at upload time. That is a cosmetic mismatch in old keys, not a
 * correctness problem — `audio_key` is stored per segment and never
 * regenerated, so nothing breaks, but do not "fix" it by trying to rename
 * existing R2 objects to match.
 */
shedRoutes.patch('/:id', requireSuperAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ code?: string; name?: string; active?: boolean }>();

  if (body.code !== undefined) {
    const code = body.code.trim();
    if (!code) return c.json({ error: 'code cannot be empty' }, 400);
    try {
      await c.env.DB.prepare('UPDATE sheds SET code = ? WHERE id = ?').bind(code, id).run();
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: 'that code is already in use' }, 409);
      throw err;
    }
  }
  if (body.name !== undefined) {
    await c.env.DB.prepare('UPDATE sheds SET name = ? WHERE id = ?').bind(body.name, id).run();
  }
  if (body.active !== undefined) {
    // A shed is its machines. Deactivating the shed but leaving 56 looms
    // marked active would leave them showing up in pickers and reports for a
    // shed that is supposed to be shut, so the state moves together.
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE sheds SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, id),
      c.env.DB.prepare('UPDATE machines SET active = ? WHERE shed_id = ?').bind(
        body.active ? 1 : 0,
        id,
      ),
    ]);
  }

  const row = await c.env.DB.prepare('SELECT * FROM sheds WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ shed: mapShed(row) });
});

/**
 * Owner tier only, and genuinely destructive: every machine, log, segment,
 * item and edit under this shed is gone, not deactivated. Deactivate (PATCH
 * active:false) is the routine, reversible operation; this is for "this
 * shed does not exist, remove it and everything in it."
 *
 * D1 enforces foreign keys, so the delete order matters: logs first (which
 * cascades to log_segments/log_items/log_edits/match_misses on its own FKs),
 * then machines, then the shed itself (which cascades user_sheds). Audio
 * blobs are best-effort cleaned up after the DB commit — losing a stray R2
 * object is a cost worth paying rather than blocking the delete on R2 being
 * reachable. A summary goes to admin_audit before anything is removed,
 * since nothing here can be reconstructed from the DB afterward.
 */
shedRoutes.delete('/:id', requireSuperAdmin, async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');

  const shed = await c.env.DB.prepare('SELECT * FROM sheds WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!shed) return c.json({ error: 'not found' }, 404);

  const [{ results: audioRows }, counts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ls.audio_key FROM log_segments ls
       JOIN logs l ON l.id = ls.log_id
       JOIN machines m ON m.id = l.machine_id
       WHERE m.shed_id = ? AND ls.audio_key IS NOT NULL`,
    )
      .bind(id)
      .all<{ audio_key: string }>(),
    c.env.DB.batch([
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM machines WHERE shed_id = ?').bind(id),
      c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM logs WHERE machine_id IN (SELECT id FROM machines WHERE shed_id = ?)',
      ).bind(id),
    ]),
  ]);
  const machineCount = (counts[0]!.results[0] as { n: number }).n;
  const logCount = (counts[1]!.results[0] as { n: number }).n;

  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM logs WHERE machine_id IN (SELECT id FROM machines WHERE shed_id = ?)',
    ).bind(id),
    c.env.DB.prepare('DELETE FROM machines WHERE shed_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM sheds WHERE id = ?').bind(id),
    c.env.DB.prepare(
      `INSERT INTO admin_audit (id, actor_phone, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, 'delete_shed', 'shed', ?, ?, ?)`,
    ).bind(
      uuidv7(),
      session.phone,
      id,
      JSON.stringify({ code: shed.code, name: shed.name, machineCount, logCount }),
      Date.now(),
    ),
  ]);

  await Promise.all(
    audioRows.map((r) => c.env.AUDIO.delete(r.audio_key).catch(() => {})),
  );

  return c.json({ ok: true, deleted: { machines: machineCount, logs: logCount } });
});
