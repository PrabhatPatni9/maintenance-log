import type { SttMode } from '@shared/types';
import { api } from './api';
import { kvGet, kvSet } from './db';

/**
 * `STT_MODE` is a config switch, not a code branch (CLAUDE.md section 11):
 * `local_only` means the client never calls SpeechRecognition at all, so
 * every segment takes the same path as an offline capture. Cached in Dexie
 * so it still applies with no network.
 */
export async function refreshSttMode(): Promise<void> {
  try {
    const { sttMode } = await api.get<{ sttMode: SttMode }>('/config');
    await kvSet('sttMode', sttMode);
  } catch {
    /* keep whatever is cached; default applies if nothing ever cached */
  }
}

export async function getSttMode(): Promise<SttMode> {
  return (await kvGet<SttMode>('sttMode')) ?? 'hybrid';
}
