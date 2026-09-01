import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { uuidv7 } from '@shared/id';
import { audioKey, signUploadToken, verifyUploadToken } from '../lib/r2';
import { fetchMachineWithShed } from '../lib/machine-lookup';
import { mapLog, mapSegment, mapItem, mapEdit } from '../lib/mappers';
import { transcribeLog } from '../lib/transcribe';
import { selectProvider } from '../stt/select';
import { canAccessShed } from '../lib/shed-access';
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

  const log = await c.env.DB.prepare('SELECT status, deleted_at FROM logs WHERE id = ?')
    .bind(logId)
    .first<{ status: string; deleted_at: number | null }>();
  if (!log) return c.json({ error: 'not found' }, 404);
  if (log.deleted_at) return c.json({ ok: true }); // already gone, idempotent

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

/** Today's logs for the operator's home screen. */
logRoutes.get('/', async (c) => {
  const session = c.get('session');
  const mine = c.req.query('mine') !== '0';
  const since = Number(c.req.query('since') ?? 0);

  const stmt = mine
    ? c.env.DB.prepare(
        'SELECT * FROM logs WHERE operator_phone = ? AND client_created_at >= ? AND deleted_at IS NULL ORDER BY client_created_at DESC LIMIT 50',
      ).bind(session.phone, since)
    : c.env.DB.prepare(
        'SELECT * FROM logs WHERE client_created_at >= ? AND deleted_at IS NULL ORDER BY client_created_at DESC LIMIT 50',
      ).bind(since);

  const { results } = await stmt.all<Record<string, unknown>>();
  return c.json({ logs: results.map(mapLog) });
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
