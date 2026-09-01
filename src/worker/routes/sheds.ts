import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireSuperAdmin, requireAuth } from '../lib/middleware';
import { mapShed } from '../lib/mappers';
import { accessibleShedIds } from '../lib/shed-access';
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

shedRoutes.post('/', requireSuperAdmin, async (c) => {
  const { code, name } = await c.req.json<{ code: string; name: string }>();
  if (!code || !name) return c.json({ error: 'code and name required' }, 400);

  const id = uuidv7();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO sheds (id, code, name, active, created_at) VALUES (?, ?, ?, 1, ?)',
  )
    .bind(id, code, name, now)
    .run();

  return c.json({ shed: { id, code, name, active: true, createdAt: now } }, 201);
});

shedRoutes.patch('/:id', requireSuperAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; active?: boolean }>();

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
