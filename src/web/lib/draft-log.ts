import { db } from './db';
import { uuidv7 } from '@shared/id';
import type { Lang, SegmentSource } from '@shared/types';
import type { SegmentResult } from './useCapture';
import { syncOnce } from './queue';
import { recordApprovedLog } from './install';

/** First segment of a new log creates the draft row; later segments in the
 * same "Add more" loop just append. `draft` never reaches the server
 * (CLAUDE.md section 5) — nothing here talks to the network. */
export async function ensureDraftLog(
  logId: string,
  machineId: string,
  operatorPhone: string,
  lang: Lang,
): Promise<void> {
  const existing = await db.outboxLogs.get(logId);
  if (existing) return;
  await db.outboxLogs.add({
    id: logId,
    machineId,
    operatorPhone,
    captureLang: lang,
    transcript: null,
    typedNote: null,
    clientCreatedAt: Date.now(),
    status: 'draft',
    syncAttempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });
}

export function sourceFor(result: SegmentResult, sttModeIsLocalOnly: boolean): SegmentSource {
  if (sttModeIsLocalOnly || !result.producedText) return 'whisper'; // audio only, server transcribes it
  return result.usedLocalInstall ? 'webspeech_local' : 'webspeech';
}

export async function saveSegment(
  logId: string,
  seq: number,
  result: SegmentResult,
  source: SegmentSource,
): Promise<void> {
  await db.outboxSegments.add({
    id: uuidv7(),
    logId,
    seq,
    audioBlob: result.blob,
    durationMs: Math.round(result.durationMs),
    source,
    transcript: result.transcript || null,
    confidence: null,
    uploaded: 0,
    audioKey: null,
  });
}

export async function finalizeAndQueue(
  logId: string,
  transcript: string,
  typedNote: string,
  items: Record<string, 'auto' | 'manual'>,
): Promise<void> {
  await db.outboxItems.where('logId').equals(logId).delete();
  await db.outboxItems.bulkAdd(
    Object.entries(items).map(([code, origin]) => ({
      id: uuidv7(),
      logId,
      code,
      qty: null,
      unit: null,
      origin,
    })),
  );

  await db.outboxLogs.update(logId, {
    transcript: transcript.trim() || null,
    typedNote: typedNote.trim() || null,
    status: 'queued',
  });

  void syncOnce();
  await recordApprovedLog();
}
