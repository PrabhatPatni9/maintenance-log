import { db } from './db';
import type { OutboxLog } from './db';
import { api, ApiError } from './api';

/**
 * The outbox. Every row here is a complete log with its segments and audio
 * blobs, safe in IndexedDB before anything is sent anywhere (CLAUDE.md
 * sections 1 and 7). Nothing in this file ever deletes a row on failure —
 * only on confirmed sync.
 */

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 2000;

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}

let syncing = false;
let listeners: (() => void)[] = [];

export function onQueueChange(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function notify() {
  for (const l of listeners) l();
}

export async function pendingCount(): Promise<number> {
  return db.outboxLogs.where('status').anyOf('queued', 'uploading', 'error').count();
}

async function pushLog(log: OutboxLog): Promise<void> {
  const [segments, items] = await Promise.all([
    db.outboxSegments.where('logId').equals(log.id).sortBy('seq'),
    db.outboxItems.where('logId').equals(log.id).toArray(),
  ]);

  await api.post('/logs', {
    id: log.id,
    machineId: log.machineId,
    captureLang: log.captureLang,
    clientCreatedAt: log.clientCreatedAt,
    transcript: log.transcript,
    typedNote: log.typedNote,
    approved: true,
    segments: segments.map((s) => ({
      id: s.id,
      seq: s.seq,
      durationMs: s.durationMs,
      source: s.source,
      transcript: s.transcript,
      confidence: s.confidence,
    })),
    items: items.map((i) => ({ id: i.id, code: i.code, qty: i.qty, unit: i.unit, origin: i.origin })),
  });

  for (const seg of segments) {
    if (seg.uploaded) continue;

    const { url, token } = await api.get<{ url: string; key: string; token: string }>(
      `/logs/${log.id}/segments/${seg.seq}/upload-url`,
    );

    const putRes = await fetch(`${url}?token=${encodeURIComponent(token)}`, {
      method: 'PUT',
      credentials: 'include',
      body: seg.audioBlob,
    });
    if (!putRes.ok) throw new Error(`audio upload failed: ${putRes.status}`);

    await api.post(`/logs/${log.id}/segments/${seg.seq}/complete`, {});
    await db.outboxSegments.update(seg.id, { uploaded: 1 });
  }
}

export async function syncOnce(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  syncing = true;

  try {
    const now = Date.now();
    const candidates = await db.outboxLogs
      .where('status')
      .anyOf('queued', 'error')
      .filter((l) => l.nextAttemptAt <= now)
      .toArray();

    for (const log of candidates) {
      await db.outboxLogs.update(log.id, { status: 'uploading' });
      notify();
      try {
        await pushLog(log);
        await db.outboxLogs.update(log.id, { status: 'synced', lastError: null });
      } catch (err) {
        const attempts = log.syncAttempts + 1;
        const message = err instanceof ApiError ? err.message : String(err);
        await db.outboxLogs.update(log.id, {
          status: 'error',
          syncAttempts: attempts,
          nextAttemptAt: Date.now() + backoffFor(attempts),
          lastError: message,
        });
      }
      notify();
    }
  } finally {
    syncing = false;
  }
}

let started = false;

/** Background Sync where available; a plain online listener plus a polling
 * interval as the fallback for iOS, which never shipped Background Sync
 * (CLAUDE.md section 7). Safe to call more than once. */
export function startSyncEngine(): void {
  if (started) return;
  started = true;

  window.addEventListener('online', () => void syncOnce());
  setInterval(() => void syncOnce(), 30_000);
  void syncOnce();

  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg) => (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync?.register('outbox-sync'))
      .catch(() => {
        /* Background Sync unsupported or blocked; the interval covers it */
      });
  }
}
