import type { Lang } from '@shared/types';
import type { SttProvider, SttResult } from './index';

/**
 * Used when WHISPER_URL is unset, which is the normal state for local dev.
 * Returning a fixed string is correct behaviour here, not a bug to fix —
 * standing up a hosted model to work around it is exactly what CLAUDE.md
 * section 2 forbids.
 */
export class StubProvider implements SttProvider {
  async transcribe(_audio: ArrayBuffer, hint: Lang): Promise<SttResult> {
    return {
      text: '[stub transcription — set WHISPER_URL for real STT]',
      detectedLang: hint,
      confidence: 0,
    };
  }
}
