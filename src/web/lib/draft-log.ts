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

export function sourceFor(result: SegmentResult, _sttModeIsLocalOnly: boolean): SegmentSource {
  // Real audio is always attached now (useCapture.ts), so 'typed' here does
  // not mean "no audio was kept" — it means no live transcript came back
  // for this segment, and whatever text the log ends up with came from the
  // operator typing in review instead. The blob still uploads to R2
  // regardless of this label (queue.ts only skips an upload for a
  // genuinely empty blob), so nothing here is lost even when this returns
  // 'typed'.
  //
  // Server-side Whisper re-transcription (CLAUDE.md section 11) is not
  // wired to run on these segments: a log only reaches
  // 'pending_transcription' when it arrives un-approved, and
  // finalizeAndQueue() always sends approved:true because the operator
  // already tapped Approve locally before this ever syncs. That is a real,
  // separate gap from the missing-audio bug this function's comment used to
  // describe — flagged, not fixed here.
  if (!result.producedText) return 'typed';
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
