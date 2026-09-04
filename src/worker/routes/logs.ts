import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../lib/middleware';
import { uuidv7 } from '@shared/id';
import { audioKey, signUploadToken, verifyUploadToken } from '../lib/r2';
import { fetchMachineWithShed } from '../lib/machine-lookup';
import { mapLog, mapSegment, mapItem, mapEdit } from '../lib/mappers';
import { transcribeLog } from '../lib/transcribe';
import { selectProvider } from '../stt/select';
import { canAccessShed } from '../lib/shed-access';
import { itemsByLogId } from '../lib/log-items';
import type { Lang, SegmentSource, ItemOrigin } from '@shared/types';

export const logRoutes = new Hono<AppEnv>();
logRoutes.use('*', requireAuth);

interface CreateLogBody {
  id: string;
  machineId: string;
  captureLang: Lang;
  clientCreatedAt: number;
  transcript: string | null;
  typedNote: string | null;
  approved: boolean;
  segments: {
    id: string;
    seq: number;
    durationMs: number;
    source: SegmentSource;
    transcript: string | null;
    confidence: number | null;
  }[];
  items: { id: string; code: string; qty: number | null; unit: string | null; origin: ItemOrigin }[];
}

/** Idempotent: the client generated `id` is the primary key, so a retried
 * upload after a dropped connection is a safe no-op on the row that already
 * landed (CLAUDE.md section 7). */
logRoutes.post('/', async (c) => {
  const body = await c.req.json<CreateLogBody>();
  const session = c.get('session');
  // The electrician's job is meters, not maintenance notes — same
  // separation of concerns as meter-readings.ts's canRecordReadings, just
  // the other direction. Admin and super_admin can still cover for an
  // absent operator.
  if (session.role === 'utility_operator') return c.json({ error: 'forbidden' }, 403);

  const existing = await c.env.DB.prepare('SELECT id FROM logs WHERE id = ?')
    .bind(body.id)
    .first();

  if (!existing) {
    const machine = await fetchMachineWithShed(c.env.DB, body.machineId);
    if (!machine) return c.json({ error: 'machine not found' }, 404);
    if (!(await canAccessShed(c.env.DB, session, machine.shedId))) {
      return c.json({ error: 'forbidden' }, 403);
    }

    const hasTranscript = Boolean(body.transcript && body.transcript.trim());
    const status = body.approved ? 'approved' : hasTranscript ? 'awaiting_review' : 'pending_transcription';
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO logs
        (id, machine_id, operator_phone, status, capture_lang, transcript, typed_note,
         client_created_at, server_received_at, approved_at, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(
        body.id,
        body.machineId,
        session.phone,
        status,
        body.captureLang,
        body.transcript,
        body.typedNote,
        body.clientCreatedAt,
        now,
        body.approved ? now : null,
      )
      .run();

    const statements = body.segments.map((s) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO log_segments (id, log_id, seq, source, transcript, confidence, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(s.id, body.id, s.seq, s.source, s.transcript, s.confidence, s.durationMs),
    );
    for (const item of body.items) {
      statements.push(
        c.env.DB.prepare(
          'INSERT OR IGNORE INTO log_items (id, log_id, code, qty, unit, origin) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(item.id, body.id, item.code, item.qty, item.unit, item.origin),
      );
    }
    if (statements.length > 0) await c.env.DB.batch(statements);
  }

  return c.json({ ok: true, id: body.id }, 201);
});

logRoutes.get('/:id/segments/:seq/upload-url', async (c) => {
  const logId = c.req.param('id');
  const seq = Number(c.req.param('seq'));

  const log = await c.env.DB.prepare('SELECT machine_id FROM logs WHERE id = ?')
    .bind(logId)
    .first<{ machine_id: string }>();
  if (!log) return c.json({ error: 'not found' }, 404);

  const machine = await fetchMachineWithShed(c.env.DB, log.machine_id);
  if (!machine) return c.json({ error: 'machine not found' }, 404);

  const key = audioKey(machine.shedCode, machine.machineNo, logId, seq);
  const token = await signUploadToken(c.env, key);
  return c.json({ url: `/api/logs/${logId}/segments/${seq}/audio`, key, token });
});

logRoutes.put('/:id/segments/:seq/audio', async (c) => {
  const logId = c.req.param('id');
  const seq = Number(c.req.param('seq'));
  const token = c.req.query('token');

  const log = await c.env.DB.prepare('SELECT machine_id FROM logs WHERE id = ?')
    .bind(logId)
    .first<{ machine_id: string }>();
  if (!log) return c.json({ error: 'not found' }, 404);

  const machine = await fetchMachineWithShed(c.env.DB, log.machine_id);
  if (!machine) return c.json({ error: 'machine not found' }, 404);

  const key = audioKey(machine.shedCode, machine.machineNo, logId, seq);
  if (!token || !(await verifyUploadToken(c.env, key, token))) {
    return c.json({ error: 'invalid or expired upload token' }, 403);
  }

  const bytes = await c.req.arrayBuffer();
  await c.env.AUDIO.put(key, bytes, { httpMetadata: { contentType: 'audio/webm' } });

  await c.env.DB.prepare(
    'UPDATE log_segments SET audio_key = ?, audio_bytes = ? WHERE log_id = ? AND seq = ?',
  )
    .bind(key, bytes.byteLength, logId, seq)
    .run();

  return c.json({ ok: true, bytes: bytes.byteLength });
});

logRoutes.post('/:id/segments/:seq/complete', async (c) => {
  const logId = c.req.param('id');

  // Attempt transcription right away if this log still needs it — a best
  // effort fast path. If Whisper is busy or down, the cron sweeper in
  // index.ts picks it up later; nothing here is required for correctness.
  c.executionCtx.waitUntil(
    (async () => {
      const log = await c.env.DB.prepare('SELECT status FROM logs WHERE id = ?')
        .bind(logId)
        .first<{ status: string }>();
      if (log?.status === 'pending_transcription') {
        await transcribeLog(c.env, selectProvider(c.env), logId).catch(() => {});
      }
    })(),
  );

  return c.json({ ok: true });
});

logRoutes.post('/:id/approve', async (c) => {
  const logId = c.req.param('id');
  const session = c.get('session');

  const log = await c.env.DB.prepare('SELECT operator_phone, status FROM logs WHERE id = ?')
    .bind(logId)
    .first<{ operator_phone: string; status: string }>();
  if (!log) return c.json({ error: 'not found' }, 404);
  if (log.operator_phone !== session.phone && session.role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (log.status === 'approved') return c.json({ ok: true }); // already locked, idempotent

  await c.env.DB.prepare('UPDATE logs SET status = ?, approved_at = ? WHERE id = ?')
    .bind('approved', Date.now(), logId)
    .run();

  return c.json({ ok: true });
});

/**
 * Throw out a bogus log. Admin only, and a deactivation rather than a real
 * DELETE: the row stays, stamped with who removed it and when, and an entry
 * goes into log_edits so the audit trail still explains itself. Every list,
 * the CSV export included, filters on deleted_at IS NULL, so as far as
 * anyone using the app is concerned it is gone.
 */
logRoutes.delete('/:id', requireAdmin, async (c) => {
  const logId = c.req.param('id');
  const session = c.get('session');
  const reason = (await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined })))?.reason;

  const log = await c.env.DB.prepare('SELECT status, deleted_at, machine_id FROM logs WHERE id = ?')
    .bind(logId)
    .first<{ status: string; deleted_at: number | null; machine_id: string }>();
  if (!log) return c.json({ error: 'not found' }, 404);
  if (log.deleted_at) return c.json({ ok: true }); // already gone, idempotent

  // requireAdmin now also passes a shed-scoped admin: they may only take a
  // log they could otherwise see out of the shed they were granted.
  const machine = await fetchMachineWithShed(c.env.DB, log.machine_id);
  if (!machine || !(await canAccessShed(c.env.DB, session, machine.shedId))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE logs SET deleted_at = ?, deleted_by = ? WHERE id = ?').bind(
      now,
      session.phone,
      logId,
    ),
    c.env.DB.prepare(
      `INSERT INTO log_edits (id, log_id, admin_phone, field, value_before, value_after, reason, edited_at)
       VALUES (?, ?, ?, 'deleted', 'visible', 'deleted', ?, ?)`,
    ).bind(uuidv7(), logId, session.phone, reason?.trim() || 'bogus log', now),
  ]);

  return c.json({ ok: true });
});

/** Owner tier only: undo an admin's soft-delete. The row was never actually
 * touched, so this is just clearing the two columns back to null. */
logRoutes.post('/:id/restore', requireSuperAdmin, async (c) => {
  const logId = c.req.param('id');
  const session = c.get('session');

  const log = await c.env.DB.prepare('SELECT deleted_at FROM logs WHERE id = ?')
    .bind(logId)
    .first<{ deleted_at: number | null }>();
  if (!log) return c.json({ error: 'not found' }, 404);
  if (!log.deleted_at) return c.json({ ok: true }); // was never deleted, idempotent

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE logs SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').bind(logId),
    c.env.DB.prepare(
      `INSERT INTO admin_audit (id, actor_phone, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, 'restore_log', 'log', ?, NULL, ?)`,
    ).bind(uuidv7(), session.phone, logId, Date.now()),
  ]);

  return c.json({ ok: true });
});

/**
 * Owner tier only, and genuinely irreversible: the log, its segments, items
 * and edit history are all gone (CASCADE off logs.id), not deactivated. A
 * summary goes to admin_audit first, since that is the only place any trace
 * of this log survives afterward. Segment audio is best-effort cleaned up
 * from R2 after the DB commit.
 */
logRoutes.delete('/:id/purge', requireSuperAdmin, async (c) => {
  const logId = c.req.param('id');
  const session = c.get('session');

  const log = await c.env.DB.prepare('SELECT * FROM logs WHERE id = ?')
    .bind(logId)
    .first<Record<string, unknown>>();
  if (!log) return c.json({ error: 'not found' }, 404);

  const { results: audioRows } = await c.env.DB.prepare(
    'SELECT audio_key FROM log_segments WHERE log_id = ? AND audio_key IS NOT NULL',
  )
    .bind(logId)
    .all<{ audio_key: string }>();

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM logs WHERE id = ?').bind(logId),
    c.env.DB.prepare(
      `INSERT INTO admin_audit (id, actor_phone, action, target_type, target_id, detail, created_at)
       VALUES (?, ?, 'purge_log', 'log', ?, ?, ?)`,
    ).bind(
      uuidv7(),
      session.phone,
      logId,
      JSON.stringify({ transcript: log.transcript, machineId: log.machine_id, operatorPhone: log.operator_phone }),
      Date.now(),
    ),
  ]);

  await Promise.all(audioRows.map((r) => c.env.AUDIO.delete(r.audio_key).catch(() => {})));

  return c.json({ ok: true });
});

/**
 * Home's "today" list and the full History screen's day-by-day archive are
 * the same query with different window bounds — `since`/`before` bracket a
 * time range, newest first, capped at `limit` (History pages backward in
 * time with `before` on each "load more"). Joined out to the machine and
 * shed, and to the pills each log carries — a bare transcript string told
 * the operator nothing at a glance about which loom or what was done.
 */
logRoutes.get('/', async (c) => {
  const session = c.get('session');
  const mine = c.req.query('mine') !== '0';
  const since = Number(c.req.query('since') ?? 0);
  const before = Number(c.req.query('before') ?? Number.MAX_SAFE_INTEGER);
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 50)));

  const select = `
    SELECT l.*, m.machine_no, s.code AS shed_code, s.name AS shed_name
    FROM logs l
    JOIN machines m ON m.id = l.machine_id
    JOIN sheds s ON s.id = m.shed_id
  `;
  const stmt = mine
    ? c.env.DB.prepare(
        `${select} WHERE l.operator_phone = ? AND l.client_created_at >= ? AND l.client_created_at < ? AND l.deleted_at IS NULL ORDER BY l.client_created_at DESC LIMIT ?`,
      ).bind(session.phone, since, before, limit)
    : c.env.DB.prepare(
        `${select} WHERE l.client_created_at >= ? AND l.client_created_at < ? AND l.deleted_at IS NULL ORDER BY l.client_created_at DESC LIMIT ?`,
      ).bind(since, before, limit);

  const { results } = await stmt.all<Record<string, unknown>>();
  const itemsByLog = await itemsByLogId(c.env.DB, results.map((r) => r.id as string));

  const logs = results.map((r) => ({
    ...mapLog(r),
    machineNo: r.machine_no as string,
    shedCode: r.shed_code as string,
    shedName: r.shed_name as string,
    items: itemsByLog.get(r.id as string) ?? [],
  }));
  return c.json({ logs });
});

logRoutes.get('/:id', async (c) => {
  const logId = c.req.param('id');

  const row = await c.env.DB.prepare('SELECT * FROM logs WHERE id = ? AND deleted_at IS NULL')
    .bind(logId)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);

  const machine = await fetchMachineWithShed(c.env.DB, row.machine_id as string);
  const operator = await c.env.DB.prepare('SELECT name FROM users WHERE phone = ?')
    .bind(row.operator_phone)
    .first<{ name: string }>();

  const [{ results: segRows }, { results: itemRows }, { results: editRows }] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM log_segments WHERE log_id = ? ORDER BY seq')
      .bind(logId)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT * FROM log_items WHERE log_id = ?').bind(logId).all<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT * FROM log_edits WHERE log_id = ? ORDER BY edited_at DESC')
      .bind(logId)
      .all<Record<string, unknown>>(),
  ]);

  return c.json({
    log: {
      ...mapLog(row),
      machineNo: machine?.machineNo ?? '',
      shedCode: machine?.shedCode ?? '',
      shedName: machine?.shedName ?? '',
      operatorName: operator?.name ?? row.operator_phone,
      segments: segRows.map(mapSegment),
      items: itemRows.map(mapItem),
      edits: editRows.map(mapEdit),
    },
  });
});
