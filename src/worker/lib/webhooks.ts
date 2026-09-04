import type { Env } from './env';
import { hmacSha256Hex } from '@shared/crypto';
import { fetchMachineWithShed } from './machine-lookup';
import { itemsByLogId } from './log-items';

export type WebhookEvent = 'log_approved' | 'meter_reading';

/**
 * Best-effort outbound push, fired from `ctx.waitUntil()` so it never holds
 * up the response a user is waiting on — same "never block the user-facing
 * route" discipline as transcription (CLAUDE.md section 11). A failed
 * delivery is recorded on the row (last_status/last_error) for the super
 * admin panel to show, but nothing here retries: the record it was
 * reporting is already safely in D1 regardless of whether the push lands.
 *
 * Scope matching: 'global' always fires; 'shed' fires when `scope.shedId`
 * matches; 'machine' fires when `scope.machineId` matches. A meter reading
 * has no single machine (a meter can cover several), so callers for
 * 'meter_reading' never pass `machineId` and machine-scoped webhooks never
 * see that event.
 */
export async function fireWebhooks(
  env: Env,
  event: WebhookEvent,
  scope: { shedId: string; machineId?: string },
  data: unknown,
): Promise<void> {
  const conditions = ["scope_type = 'global'", "(scope_type = 'shed' AND scope_id = ?)"];
  const binds: unknown[] = [scope.shedId];
  if (scope.machineId) {
    conditions.push("(scope_type = 'machine' AND scope_id = ?)");
    binds.push(scope.machineId);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, url, secret FROM webhooks WHERE active = 1 AND (${conditions.join(' OR ')})`,
  )
    .bind(...binds)
    .all<{ id: string; url: string; secret: string }>();
  if (results.length === 0) return;

  const body = JSON.stringify({ event, firedAt: Date.now(), data });

  await Promise.all(
    results.map(async (w) => {
      let status: number | null = null;
      let error: string | null = null;
      try {
        const signature = await hmacSha256Hex(w.secret, body);
        const res = await fetch(w.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-event': event,
            'x-webhook-signature': `sha256=${signature}`,
          },
          body,
        });
        status = res.status;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (err) {
        error = err instanceof Error ? err.message : 'delivery failed';
      }
      await env.DB.prepare('UPDATE webhooks SET last_fired_at = ?, last_status = ?, last_error = ? WHERE id = ?')
        .bind(Date.now(), status, error, w.id)
        .run();
    }),
  );
}

/**
 * Builds the log_approved payload from just a log id and fires it — the one
 * place that shape is assembled, called from both the create path (a log
 * that syncs already approved, the normal offline-first flow) and the
 * separate approve endpoint, so neither has to duplicate the machine/items/
 * label lookups. Swallows its own errors: called from `waitUntil`, so
 * nothing is waiting on the result.
 */
export async function fireLogApprovedWebhook(env: Env, logId: string): Promise<void> {
  const log = await env.DB.prepare(
    'SELECT machine_id, operator_phone, transcript, typed_note, client_created_at, approved_at FROM logs WHERE id = ?',
  )
    .bind(logId)
    .first<{
      machine_id: string;
      operator_phone: string;
      transcript: string | null;
      typed_note: string | null;
      client_created_at: number;
      approved_at: number | null;
    }>();
  if (!log) return;

  const machine = await fetchMachineWithShed(env.DB, log.machine_id);
  if (!machine) return;

  const [operator, itemsByLog] = await Promise.all([
    env.DB.prepare('SELECT name FROM users WHERE phone = ?').bind(log.operator_phone).first<{ name: string }>(),
    itemsByLogId(env.DB, [logId]),
  ]);
  const items = itemsByLog.get(logId) ?? [];

  const labels =
    items.length > 0
      ? await env.DB.prepare(
          `SELECT code, label_en FROM taxonomy_items WHERE code IN (${items.map(() => '?').join(',')})`,
        )
          .bind(...items.map((i) => i.code))
          .all<{ code: string; label_en: string }>()
      : { results: [] };
  const labelByCode = new Map(labels.results.map((r) => [r.code, r.label_en]));

  await fireWebhooks(
    env,
    'log_approved',
    { shedId: machine.shedId, machineId: machine.id },
    {
      id: logId,
      machineNo: machine.machineNo,
      shedCode: machine.shedCode,
      shedName: machine.shedName,
      operatorPhone: log.operator_phone,
      operatorName: operator?.name ?? log.operator_phone,
      transcript: log.transcript,
      typedNote: log.typed_note,
      items: items.map((i) => ({ code: i.code, label: labelByCode.get(i.code) ?? i.code, qty: i.qty, unit: i.unit })),
      clientCreatedAt: log.client_created_at,
      approvedAt: log.approved_at,
    },
  );
}

/**
 * Same idea as fireLogApprovedWebhook, for a meter_reading event — called
 * after every reading create, same-day resubmission, and past-day
 * correction (meter-readings.ts), since "everything, as it happens" means a
 * corrected value reaching the Sheet matters as much as the original did.
 * No `machineId` in scope: a meter can cover several machines, so only
 * global and shed-scoped webhooks ever see this event (see fireWebhooks).
 */
export async function fireMeterReadingWebhook(env: Env, readingId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT r.id, r.reading_date, r.kwh_reading, r.pf_reading, r.note, r.recorded_by, r.recorded_at,
            m.code AS meter_code, m.name AS meter_name, m.shed_id, s.code AS shed_code, s.name AS shed_name
     FROM meter_readings r
     JOIN meters m ON m.id = r.meter_id
     JOIN sheds s ON s.id = m.shed_id
     WHERE r.id = ?`,
  )
    .bind(readingId)
    .first<{
      id: string;
      reading_date: string;
      kwh_reading: number;
      pf_reading: number | null;
      note: string | null;
      recorded_by: string;
      recorded_at: number;
      meter_code: string;
      meter_name: string | null;
      shed_id: string;
      shed_code: string;
      shed_name: string;
    }>();
  if (!row) return;

  const recordedByUser = await env.DB.prepare('SELECT name FROM users WHERE phone = ?')
    .bind(row.recorded_by)
    .first<{ name: string }>();

  await fireWebhooks(
    env,
    'meter_reading',
    { shedId: row.shed_id },
    {
      id: row.id,
      meterCode: row.meter_code,
      meterName: row.meter_name,
      shedCode: row.shed_code,
      shedName: row.shed_name,
      readingDate: row.reading_date,
      kwhReading: row.kwh_reading,
      pfReading: row.pf_reading,
      note: row.note,
      recordedByPhone: row.recorded_by,
      recordedByName: recordedByUser?.name ?? row.recorded_by,
      recordedAt: row.recorded_at,
    },
  );
}
