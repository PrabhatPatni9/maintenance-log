import type { Lang, Role, SttMode } from '@shared/types';

export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;

  STT_PROVIDER: 'whisper' | 'stub';
  STT_MODE: SttMode;
  AUDIO_RETENTION_DAYS: string;
  APP_TIMEZONE: string;

  JWT_SECRET: string;
  WHISPER_URL?: string;
  WHISPER_TOKEN?: string;
}

export interface SessionRecord {
  phone: string;
  name: string;
  role: Role;
  isOperator: boolean;
  isUtility: boolean;
  lang: Lang;
}

/** The Hono generic every route and lib function in this Worker shares, so
 * a Context type declared in one file is assignable everywhere else. */
export type AppEnv = { Bindings: Env; Variables: { session: SessionRecord } };
