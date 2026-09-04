import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../lib/middleware';
import { mapMeter } from '../lib/mappers';
import { buildSetClause } from '../lib/sql-update';
import { accessibleShedIds, canAccessShed } from '../lib/shed-access';
import { uuidv7 } from '@shared/id';

/**
 * Meters, unlike machines, are add/edit-able by a shed-scoped admin, not
 * just the owner tier — confirmed scope: meters are new and low-risk to
 * over-create, so the machine-add lockdown (built after a real "56 machines
 * in the wrong shed" incident) does not extend here. Delete is still
 * owner-tier only, same as everything else genuinely destructive.
 */
export const meterRoutes = new Hono<AppEnv>();
meterRoutes.use('*', requireAuth);

meterRoutes.get('/', async (c) => {
  const session = c.get('session');
  const shedId = c.req.query('shedId');

  if (shedId) {
    if (!(await canAccessShed(c.env.DB, session, shedId))) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { results } = await c.env.DB.prepare('SELECT * FROM meters WHERE shed_id = ? ORDER BY code')
      .bind(shedId)
      .all<Record<string, unknown>>();
    return c.json({ meters: results.map(mapMeter) });
  }

  const allowed = await accessibleShedIds(c.env.DB, session);
  if (allowed === 'all') {
    const { results } = await c.env.DB.prepare('SELECT * FROM meters ORDER BY shed_id, code').all<
      Record<string, unknown>
    >();
    return c.json({ meters: results.map(mapMeter) });
  }
  if (allowed.length === 0) return c.json({ meters: [] });

  const placeholders = allowed.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM meters WHERE shed_id IN (${placeholders}) ORDER BY shed_id, code`,
  )
    .bind(...allowed)
    .all<Record<string, unknown>>();
  return c.json({ meters: results.map(mapMeter) });
});

meterRoutes.post('/', requireAdmin, async (c) => {
  const session = c.get('session');
  const body = await c.req.json<{ shedId: string; code: string; name?: string }>();
  if (!body.shedId || !body.code) return c.json({ error: 'shedId and code required' }, 400);
  if (!(await canAccessShed(c.env.DB, session, body.shedId))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const id = uuidv7();
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      'INSERT INTO meters (id, shed_id, code, name, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    )
      .bind(id, body.shedId, body.code, body.name ?? null, now)
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'that meter code already exists in this shed' }, 409);
    }
    throw err;
  }

  const row = await c.env.DB.prepare('SELECT * FROM meters WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return c.json({ meter: mapMeter(row!) }, 201);
});

meterRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const body = await c.req.json<Partial<{ code: string; name: string; active: boolean }>>();

  const existing = await c.env.DB.prepare('SELECT shed_id FROM meters WHERE id = ?')
    .bind(id)
    .first<{ shed_id: string }>();
  if (!existing) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, existing.shed_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const { setClause, binds } = buildSetClause({
    code: body.code,
    name: body.name,
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  });

  if (setClause) {
    try {
      await c.env.DB.prepare(`UPDATE meters SET ${setClause} WHERE id = ?`)
        .bind(...binds, id)
        .run();
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'that meter code already exists in this shed' }, 409);
      }
      throw err;
    }
  }

  // A deactivated meter's machines fall off the meter — a reading no one is
  // taking any more should not keep silently attributing consumption to
  // machines that (as far as this system knows) are no longer wired to it.
  if (body.active === false) {
    await c.env.DB.prepare('UPDATE machines SET meter_id = NULL WHERE meter_id = ?').bind(id).run();
  }

  const row = await c.env.DB.prepare('SELECT * FROM meters WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ meter: mapMeter(row) });
});

/**
 * Owner tier only. Unassigns every machine on this meter, then deletes the
 * meter's readings, edit trail, and the meter itself — same
 * audit-then-cascade pattern as sheds.ts/machines.ts.
 */
meterRoutes.delete('/:id', requireSuperAdmin, async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');

  const meter = await c.env.DB.prepare('SELECT * FROM meters WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!meter) return c.json({ error: 'not found' }, 404);

  const readingCountRow = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM meter_readings WHERE meter_id = ?')
    .bind(id)
    .first<{ n: number }>();

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE machines SET meter_id = NULL WHERE meter_id = ?').bind(id),
    c.env.DB.prepare(
      'DELETE FROM meter_reading_edits WHERE reading_id IN (SELECT id FROM meter_readings WHERE meter_id = ?)',
    ).bind(id),
    c.env.DB.prepare('DELETE FROM meter_readings WHERE meter_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM meters WHERE id = ?').bind(id),
    c.env.DB.prepare(
      `INSERT INTO admin_audit (id, actor_phone, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, 'delete_meter', 'meter', ?, ?, ?)`,
    ).bind(
      uuidv7(),
      session.phone,
      id,
      JSON.stringify({ code: meter.code, shedId: meter.shed_id, readingCount: readingCountRow?.n ?? 0 }),
      Date.now(),
    ),
  ]);

  return c.json({ ok: true, deleted: { readings: readingCountRow?.n ?? 0 } });
});
