import type { Lang } from '@shared/types';
import type { SttProvider, SttResult } from './index';
import { SttBusyError } from './index';

/**
 * Posts to faster-whisper on KVM4 (docs/whisper-vps.md). Concurrency there is
 * exactly 1; a 503 means "busy", not broken, and the caller (the cron
 * sweeper) is expected to retry with backoff rather than fail the log.
 *
 * Expect 60-100 seconds for a 50 second clip. This must only ever be called
 * from ctx.waitUntil() or the cron handler, never from a route a user is
 * waiting on.
 */
export class WhisperProvider implements SttProvider {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async transcribe(audio: ArrayBuffer, hint: Lang): Promise<SttResult> {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/webm' }), 'segment.webm');
    form.append('lang', hint);

    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });

    if (res.status === 503) throw new SttBusyError('whisper service busy');
    if (!res.ok) throw new Error(`whisper service error: ${res.status}`);

    const body = (await res.json()) as {
      text: string;
      detectedLang: string;
      confidence?: number;
    };

    return {
      text: body.text,
      detectedLang: (['en', 'hi', 'mr'] as const).includes(body.detectedLang as Lang)
        ? (body.detectedLang as Lang)
        : hint,
      confidence: body.confidence,
    };
  }
}
