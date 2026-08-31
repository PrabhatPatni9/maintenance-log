import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { mapMachine } from '../lib/mappers';
import { buildSetClause } from '../lib/sql-update';
import { accessibleShedIds, canAccessShed } from '../lib/shed-access';
import { uuidv7 } from '@shared/id';

export const machineRoutes = new Hono<AppEnv>();
machineRoutes.use('*', requireAuth);

/** Same shed-scoping as GET /api/sheds: an operator only ever sees machines
 * in a shed they were granted. */
machineRoutes.get('/', async (c) => {
  const session = c.get('session');
  const shedId = c.req.query('shedId');

  if (shedId) {
    if (!(await canAccessShed(c.env.DB, session, shedId))) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const { results } = await c.env.DB.prepare(
      // machine_no is TEXT ("as painted on the loom"), so a plain ORDER BY
      // sorts lexically and puts "10" before "2". CAST to INTEGER for the
      // real world (plain digits) and fall back to text as a tie-breaker.
      'SELECT * FROM machines WHERE shed_id = ? ORDER BY CAST(machine_no AS INTEGER), machine_no',
    )
      .bind(shedId)
      .all<Record<string, unknown>>();
    return c.json({ machines: results.map(mapMachine) });
  }

  const allowed = await accessibleShedIds(c.env.DB, session);
  if (allowed === 'all') {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM machines ORDER BY shed_id, CAST(machine_no AS INTEGER), machine_no',
    ).all<Record<string, unknown>>();
    return c.json({ machines: results.map(mapMachine) });
  }

  if (allowed.length === 0) return c.json({ machines: [] });

  const placeholders = allowed.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM machines WHERE shed_id IN (${placeholders}) ORDER BY shed_id, CAST(machine_no AS INTEGER), machine_no`,
  )
    .bind(...allowed)
    .all<Record<string, unknown>>();
  return c.json({ machines: results.map(mapMachine) });
});

machineRoutes.post('/', requireAdmin, async (c) => {
  const body = await c.req.json<{
    shedId: string;
    machineNo: string;
    make?: string;
    model?: string;
    loomType?: string;
    shedviewId?: string;
    installedOn?: string;
  }>();
  if (!body.shedId || !body.machineNo) {
    return c.json({ error: 'shedId and machineNo required' }, 400);
  }

  const id = uuidv7();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO machines
      (id, shed_id, machine_no, make, model, loom_type, shedview_id, installed_on, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      id,
      body.shedId,
      body.machineNo,
      body.make ?? null,
      body.model ?? null,
      body.loomType ?? null,
      body.shedviewId ?? null,
      body.installedOn ?? null,
      now,
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM machines WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({ machine: mapMachine(row!) }, 201);
});

/** "1-56" -> 56 machines in one call, because nobody adds 56 looms one at a
 * time (PROMPTS.md phase 1). Also accepts a plain comma list like "1,2,5". */
function expandRange(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      for (let n = Math.min(start, end); n <= Math.max(start, end); n++) out.push(String(n));
    } else if (trimmed) {
      out.push(trimmed);
    }
  }
  return out;
}

machineRoutes.post('/bulk', requireAdmin, async (c) => {
  const body = await c.req.json<{
    shedId: string;
    range: string;
    loomType?: string;
    make?: string;
  }>();
  if (!body.shedId || !body.range) return c.json({ error: 'shedId and range required' }, 400);

  const numbers = expandRange(body.range);
  if (numbers.length === 0) return c.json({ error: 'no machine numbers in range' }, 400);

  const now = Date.now();
  const statements = numbers.map((machineNo) =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO machines
        (id, shed_id, machine_no, make, loom_type, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).bind(uuidv7(), body.shedId, machineNo, body.make ?? null, body.loomType ?? null, now),
  );
  await c.env.DB.batch(statements);

  return c.json({ created: numbers.length });
});

machineRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<{
    machineNo: string;
    make: string;
    model: string;
    loomType: string;
    shedviewId: string;
    installedOn: string;
    active: boolean;
  }>>();

  const { setClause, binds } = buildSetClause({
    machine_no: body.machineNo,
    make: body.make,
    model: body.model,
    loom_type: body.loomType,
    shedview_id: body.shedviewId,
    installed_on: body.installedOn,
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  });

  if (setClause) {
    await c.env.DB.prepare(`UPDATE machines SET ${setClause} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }

  const row = await c.env.DB.prepare('SELECT * FROM machines WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ machine: mapMachine(row) });
});
