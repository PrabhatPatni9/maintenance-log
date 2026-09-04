import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../lib/middleware';
import { mapMachine } from '../lib/mappers';
import { buildSetClause } from '../lib/sql-update';
import { accessibleShedIds, canAccessShed } from '../lib/shed-access';
import { itemsByLogId } from '../lib/log-items';
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

// Adding, renaming, moving or deleting a machine is owner-tier only. A
// shed-scoped admin creating the wrong count in the wrong shed (56 looms
// meant to be split across Shed A and Shed B, added to Shed A whole) is
// exactly the mistake this restricts: only activate/deactivate is left at
// the admin tier, and that can never change how many machine rows exist.
machineRoutes.post('/', requireSuperAdmin, async (c) => {
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

machineRoutes.post('/bulk', requireSuperAdmin, async (c) => {
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

/**
 * A shed-scoped admin may only flip `active` and assign/unassign `meterId`.
 * Renaming a machine number or moving it to a different shed — the actual
 * fix for "56 machines added to the wrong shed" — is owner-tier only, same
 * reasoning as POST/bulk above. Meter assignment is deliberately not in
 * that lockdown: it never changes how many machines exist or which shed
 * they belong to, only which of that shed's own meters a machine sits
 * behind — the necessary counterpart of admins being able to add meters at
 * all (otherwise a meter they create has no way to ever get a machine on it).
 */
machineRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const body = await c.req.json<Partial<{
    machineNo: string;
    shedId: string;
    make: string;
    model: string;
    loomType: string;
    shedviewId: string;
    installedOn: string;
    meterId: string | null;
    active: boolean;
  }>>();

  const existing = await c.env.DB.prepare('SELECT shed_id FROM machines WHERE id = ?')
    .bind(id)
    .first<{ shed_id: string }>();
  if (!existing) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, existing.shed_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const editingFields =
    body.machineNo !== undefined ||
    body.shedId !== undefined ||
    body.make !== undefined ||
    body.model !== undefined ||
    body.loomType !== undefined ||
    body.shedviewId !== undefined ||
    body.installedOn !== undefined;
  if (editingFields && session.role !== 'super_admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (body.shedId !== undefined && !(await canAccessShed(c.env.DB, session, body.shedId))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (body.meterId) {
    // A machine can only ever be assigned to a meter in its own shed.
    const meter = await c.env.DB.prepare('SELECT shed_id FROM meters WHERE id = ?')
      .bind(body.meterId)
      .first<{ shed_id: string }>();
    if (!meter || meter.shed_id !== existing.shed_id) {
      return c.json({ error: 'meter must belong to the same shed' }, 400);
    }
  }

  const { setClause, binds } = buildSetClause({
    machine_no: body.machineNo,
    shed_id: body.shedId,
    make: body.make,
    model: body.model,
    loom_type: body.loomType,
    shedview_id: body.shedviewId,
    installed_on: body.installedOn,
    meter_id: body.meterId === undefined ? undefined : body.meterId,
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

/**
 * Owner tier only, and genuinely destructive: the machine, every log under
 * it, and everything those logs carry are gone, not deactivated. Mirrors
 * shedRoutes.delete('/:id') — same audit-then-cascade pattern, best-effort
 * R2 cleanup after the DB commit. This is the other half of correcting a
 * batch-add mistake: rename/move fixes a machine that should exist under a
 * different number or shed, this removes one that should never have been
 * created at all.
 */
machineRoutes.delete('/:id', requireSuperAdmin, async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');

  const machine = await c.env.DB.prepare('SELECT * FROM machines WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!machine) return c.json({ error: 'not found' }, 404);

  const [{ results: audioRows }, logCountRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ls.audio_key FROM log_segments ls
       JOIN logs l ON l.id = ls.log_id
       WHERE l.machine_id = ? AND ls.audio_key IS NOT NULL`,
    )
      .bind(id)
      .all<{ audio_key: string }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE machine_id = ?').bind(id).first<{ n: number }>(),
  ]);
  const logCount = logCountRow?.n ?? 0;

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM logs WHERE machine_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM machines WHERE id = ?').bind(id),
    c.env.DB.prepare(
      `INSERT INTO admin_audit (id, actor_phone, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, 'delete_machine', 'machine', ?, ?, ?)`,
    ).bind(
      uuidv7(),
      session.phone,
      id,
      JSON.stringify({ machineNo: machine.machine_no, shedId: machine.shed_id, logCount }),
      Date.now(),
    ),
  ]);

  await Promise.all(audioRows.map((r) => c.env.AUDIO.delete(r.audio_key).catch(() => {})));

  return c.json({ ok: true, deleted: { logs: logCount } });
});

/**
 * Full history for one machine, whoever recorded it — the operator picks a
 * shed, picks a machine, and sees everything done to it regardless of which
 * of their colleagues logged it (this is the point: a maintenance record
 * that belongs to the loom, not to whoever happened to be holding the
 * phone). Same shed-scoping as everywhere else, but open to any role —
 * unlike /api/admin/history this is not an admin screen.
 */
machineRoutes.get('/:id/history', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const days = Math.max(1, Math.min(365, Number(c.req.query('days') ?? 14)));

  const machine = await c.env.DB.prepare('SELECT * FROM machines WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!machine) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, machine.shed_id as string))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const { results: logRows } = await c.env.DB.prepare(
    `SELECT l.*, u.name AS operator_name
     FROM logs l
     JOIN users u ON u.phone = l.operator_phone
     WHERE l.machine_id = ? AND l.status = 'approved' AND l.deleted_at IS NULL AND l.client_created_at >= ?
     ORDER BY l.client_created_at DESC`,
  )
    .bind(id, since)
    .all<Record<string, unknown>>();

  const itemsByLog = await itemsByLogId(c.env.DB, logRows.map((r) => r.id as string));

  const logs = logRows.map((r) => ({
    id: r.id as string,
    operatorPhone: r.operator_phone as string,
    operatorName: (r.operator_name as string) ?? (r.operator_phone as string),
    clientCreatedAt: r.client_created_at as number,
    transcript: (r.transcript as string) ?? null,
    typedNote: (r.typed_note as string) ?? null,
    items: itemsByLog.get(r.id as string) ?? [],
  }));

  return c.json({ machine: mapMachine(machine), days, logs });
});
