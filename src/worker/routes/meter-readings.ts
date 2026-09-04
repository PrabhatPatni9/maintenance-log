import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { mapMeterReading } from '../lib/mappers';
import { accessibleShedIds, canAccessShed } from '../lib/shed-access';
import { todayInTz } from '../lib/date';
import { uuidv7 } from '@shared/id';

export const meterReadingRoutes = new Hono<AppEnv>();
meterReadingRoutes.use('*', requireAuth);

/** utility_operator, admin and super_admin can log a reading — a plain
 * maintenance operator has no business here, same separation of concerns
 * as the two roles doing two different jobs. */
function canRecordReadings(role: string): boolean {
  return role === 'utility_operator' || role === 'admin' || role === 'super_admin';
}

/**
 * Today's reading for one meter — always "today" in the shed's own
 * timezone, never a date the client picks, so this can only ever create or
 * correct *today's* row. Upsert: resubmitting today (a typo caught minutes
 * later) just overwrites today's row with no audit trail, same as
 * correcting a capture before Approve. Correcting a *past* day goes through
 * PATCH /:id instead, which does keep a trail — that reading has likely
 * already been used as tomorrow's baseline by the time anyone notices.
 */
meterReadingRoutes.post('/', async (c) => {
  const session = c.get('session');
  if (!canRecordReadings(session.role)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ meterId: string; kwhReading: number; pfReading?: number | null; note?: string }>();
  if (!body.meterId || typeof body.kwhReading !== 'number') {
    return c.json({ error: 'meterId and kwhReading required' }, 400);
  }

  const meter = await c.env.DB.prepare('SELECT shed_id FROM meters WHERE id = ?')
    .bind(body.meterId)
    .first<{ shed_id: string }>();
  if (!meter) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, meter.shed_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const readingDate = todayInTz(c.env);
  const existing = await c.env.DB.prepare(
    'SELECT id, pf_reading, note FROM meter_readings WHERE meter_id = ? AND reading_date = ?',
  )
    .bind(body.meterId, readingDate)
    .first<{ id: string; pf_reading: number | null; note: string | null }>();

  const now = Date.now();
  if (existing) {
    // Safe write: a field the client didn't send (the entry screen never
    // sends `note` unless the operator typed one) keeps whatever was
    // already there rather than being nulled out (AGENTS.md "safe write,
    // never overwrite").
    const pfReading = body.pfReading !== undefined ? body.pfReading : existing.pf_reading;
    const note = body.note !== undefined ? body.note : existing.note;
    await c.env.DB.prepare(
      'UPDATE meter_readings SET kwh_reading = ?, pf_reading = ?, note = ?, recorded_by = ?, recorded_at = ? WHERE id = ?',
    )
      .bind(body.kwhReading, pfReading, note, session.phone, now, existing.id)
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM meter_readings WHERE id = ?')
      .bind(existing.id)
      .first<Record<string, unknown>>();
    return c.json({ reading: mapMeterReading(row!) });
  }

  const id = uuidv7();
  await c.env.DB.prepare(
    `INSERT INTO meter_readings (id, meter_id, reading_date, kwh_reading, pf_reading, note, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, body.meterId, readingDate, body.kwhReading, body.pfReading ?? null, body.note ?? null, session.phone, now)
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM meter_readings WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({ reading: mapMeterReading(row!) }, 201);
});

/** One meter's raw reading history — the graph's data source. */
meterReadingRoutes.get('/meter/:meterId', async (c) => {
  const meterId = c.req.param('meterId');
  const session = c.get('session');
  const days = Math.max(1, Math.min(365, Number(c.req.query('days') ?? 30)));

  const meter = await c.env.DB.prepare('SELECT shed_id FROM meters WHERE id = ?')
    .bind(meterId)
    .first<{ shed_id: string }>();
  if (!meter) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, meter.shed_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM meter_readings WHERE meter_id = ? AND reading_date >= ? ORDER BY reading_date',
  )
    .bind(meterId, since)
    .all<Record<string, unknown>>();

  return c.json({ readings: results.map(mapMeterReading) });
});

/**
 * Correcting a past day's reading. Owner-tier and shed-admin only, and
 * always with a reason — every change appends to meter_reading_edits
 * rather than silently overwriting, the same discipline CLAUDE.md applies
 * to an approved maintenance log (section 2.4) applied here to a number
 * that tomorrow's consumption figure already depends on.
 */
meterReadingRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const body = await c.req.json<{ kwhReading?: number; pfReading?: number | null; reason: string }>();
  if (!body.reason?.trim()) return c.json({ error: 'reason required' }, 400);

  const reading = await c.env.DB.prepare(
    'SELECT r.*, m.shed_id AS meter_shed_id FROM meter_readings r JOIN meters m ON m.id = r.meter_id WHERE r.id = ?',
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!reading) return c.json({ error: 'not found' }, 404);
  if (!(await canAccessShed(c.env.DB, session, reading.meter_shed_id as string))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const now = Date.now();
  const edits: { field: string; before: string; after: string }[] = [];

  if (body.kwhReading !== undefined && body.kwhReading !== reading.kwh_reading) {
    edits.push({ field: 'kwh_reading', before: String(reading.kwh_reading), after: String(body.kwhReading) });
  }
  if (body.pfReading !== undefined && body.pfReading !== reading.pf_reading) {
    edits.push({ field: 'pf_reading', before: String(reading.pf_reading ?? ''), after: String(body.pfReading ?? '') });
  }
  if (edits.length === 0) return c.json({ ok: true });

  const statements = [
    c.env.DB.prepare(
      'UPDATE meter_readings SET kwh_reading = COALESCE(?, kwh_reading), pf_reading = ? WHERE id = ?',
    ).bind(body.kwhReading ?? null, body.pfReading !== undefined ? body.pfReading : reading.pf_reading, id),
    ...edits.map((e) =>
      c.env.DB.prepare(
        `INSERT INTO meter_reading_edits (id, reading_id, admin_phone, field, value_before, value_after, reason, edited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uuidv7(), id, session.phone, e.field, e.before, e.after, body.reason, now),
    ),
  ];
  await c.env.DB.batch(statements);

  const row = await c.env.DB.prepare('SELECT * FROM meter_readings WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({ reading: mapMeterReading(row!) });
});

/**
 * The dashboard's data source: every shed-visible meter's readings with
 * daily consumption already derived (today's kWh minus the most recent
 * earlier reading — a window function over the *full* history per meter,
 * filtered to the requested range only after LAG runs, so day one of a
 * requested window still gets a real number instead of a false null), plus
 * an equal per-machine split. No cost anywhere — kWh only, by design.
 */
meterReadingRoutes.get('/consumption', requireAdmin, async (c) => {
  const session = c.get('session');
  const shedIdParam = c.req.query('shedId');
  const days = Math.max(1, Math.min(365, Number(c.req.query('days') ?? 30)));

  let shedIds: string[];
  if (shedIdParam) {
    if (!(await canAccessShed(c.env.DB, session, shedIdParam))) return c.json({ error: 'forbidden' }, 403);
    shedIds = [shedIdParam];
  } else {
    const allowed = await accessibleShedIds(c.env.DB, session);
    if (allowed === 'all') {
      const { results } = await c.env.DB.prepare('SELECT id FROM sheds').all<{ id: string }>();
      shedIds = results.map((r) => r.id);
    } else {
      shedIds = allowed;
    }
  }
  if (shedIds.length === 0) return c.json({ rows: [] });

  const placeholders = shedIds.map(() => '?').join(',');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT
         m.id AS meter_id, m.code AS meter_code, m.shed_id, s.code AS shed_code,
         r.reading_date, r.kwh_reading, r.pf_reading,
         r.kwh_reading - LAG(r.kwh_reading) OVER (PARTITION BY r.meter_id ORDER BY r.reading_date) AS kwh_consumed
       FROM meter_readings r
       JOIN meters m ON m.id = r.meter_id
       JOIN sheds s ON s.id = m.shed_id
       WHERE m.shed_id IN (${placeholders})
     ) sub
     WHERE reading_date >= ?
     ORDER BY meter_code, reading_date`,
  )
    .bind(...shedIds, since)
    .all<Record<string, unknown>>();

  const { results: countRows } = await c.env.DB.prepare(
    `SELECT meter_id, COUNT(*) AS n FROM machines WHERE meter_id IS NOT NULL AND active = 1 GROUP BY meter_id`,
  ).all<{ meter_id: string; n: number }>();
  const machineCounts = new Map(countRows.map((r) => [r.meter_id, r.n]));

  const rows = results.map((r) => {
    const machineCount = machineCounts.get(r.meter_id as string) ?? 0;
    const kwhConsumed = r.kwh_consumed === null ? null : (r.kwh_consumed as number);
    return {
      meterId: r.meter_id as string,
      meterCode: r.meter_code as string,
      shedId: r.shed_id as string,
      shedCode: r.shed_code as string,
      readingDate: r.reading_date as string,
      kwhReading: r.kwh_reading as number,
      pfReading: (r.pf_reading as number) ?? null,
      kwhConsumed,
      machineCount,
      kwhPerMachine: kwhConsumed !== null && machineCount > 0 ? kwhConsumed / machineCount : null,
    };
  });

  return c.json({ rows });
});
