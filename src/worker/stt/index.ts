import type { Lang } from '@shared/types';

export interface SttResult {
  text: string;
  detectedLang: Lang;
  confidence?: number;
}

/** Thrown by a provider to mean "try again later", distinct from a real
 * failure. The cron sweeper in index.ts backs off on this instead of
 * marking the log failed. */
export class SttBusyError extends Error {}

export interface SttProvider {
  transcribe(audio: ArrayBuffer, hint: Lang): Promise<SttResult>;
}
