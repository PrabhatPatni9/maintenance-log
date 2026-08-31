import type { Env } from '../lib/env';
import type { SttProvider } from './index';
import { WhisperProvider } from './whisper';
import { StubProvider } from './stub';

/** Selected by STT_PROVIDER. Adding a provider means adding a case here,
 * never touching a route (CLAUDE.md section 11). */
export function selectProvider(env: Env): SttProvider {
  if (env.STT_PROVIDER === 'whisper' && env.WHISPER_URL && env.WHISPER_TOKEN) {
    return new WhisperProvider(env.WHISPER_URL, env.WHISPER_TOKEN);
  }
  return new StubProvider();
}
