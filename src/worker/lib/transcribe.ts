import type { Env } from './env';
import type { SttProvider } from '../stt';
import { SttBusyError } from '../stt';
import { fetchTaxonomy } from './taxonomy';
import { toMatchable } from '@shared/taxonomy';
import { compile, match } from '@shared/match';
import { uuidv7 } from '@shared/id';
import type { Lang } from '@shared/types';

/**
 * Fills in whatever Web Speech missed for one log, using whichever segments
 * still lack a transcript. Only acts on logs still `pending_transcription`:
 * once a log is `approved` it is immutable (CLAUDE.md section 2.4), so this
 * never touches one that got there before Whisper had a turn.
 *
 * Returns true if the log is now fully transcribed (so the caller can clear
 * it from the retry queue), false if it should be retried later.
 */
export async function transcribeLog(
  env: Env,
  provider: SttProvider,
  logId: string,
): Promise<boolean> {
  const log = await env.DB.prepare('SELECT * FROM logs WHERE id = ?')
    .bind(logId)
    .first<Record<string, unknown>>();
  if (!log || log.status !== 'pending_transcription') return true;

  const { results: segments } = await env.DB.prepare(
    'SELECT * FROM log_segments WHERE log_id = ? ORDER BY seq',
  )
    .bind(logId)
    .all<Record<string, unknown>>();

  let allDone = true;

  for (const seg of segments) {
    if (seg.transcript || !seg.audio_key) continue; // already have text, or audio not uploaded yet

    const obj = await env.AUDIO.get(seg.audio_key as string);
    if (!obj) continue; // shouldn't happen once audio_key is set, but don't crash the sweep

    try {
      const result = await provider.transcribe(await obj.arrayBuffer(), log.capture_lang as Lang);
      await env.DB.prepare(
        'UPDATE log_segments SET transcript = ?, confidence = ?, source = ?, transcribed_at = ? WHERE id = ?',
      )
        .bind(result.text, result.confidence ?? null, 'whisper', Date.now(), seg.id)
        .run();
    } catch (err) {
      if (err instanceof SttBusyError) {
        allDone = false;
        continue; // VPS is busy, not broken. Sweeper retries later.
      }
      allDone = false;
    }
  }

  if (!allDone) return false;

  const { results: finalSegments } = await env.DB.prepare(
    'SELECT transcript FROM log_segments WHERE log_id = ? ORDER BY seq',
  )
    .bind(logId)
    .all<{ transcript: string | null }>();

  const transcript = finalSegments
    .map((s) => s.transcript)
    .filter(Boolean)
    .join(' ')
    .trim();

  const taxonomy = compile(toMatchable(await fetchTaxonomy(env.DB)));
  const matches = match(transcript, taxonomy);

  const statements = matches.map((m) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO log_items (id, log_id, code, origin) VALUES (?, ?, ?, ?)',
    ).bind(uuidv7(), logId, m.code, 'auto'),
  );
  statements.push(
    env.DB.prepare('UPDATE logs SET transcript = ?, status = ? WHERE id = ?').bind(
      transcript,
      'awaiting_review',
      logId,
    ),
  );
  await env.DB.batch(statements);

  return true;
}
