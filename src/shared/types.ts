/**
 * The contract between the Worker and the web app. Anything used by both
 * sides lives here and nowhere else (CLAUDE.md section 4).
 */

export type Lang = 'en' | 'hi' | 'mr';

export type Role = 'admin' | 'operator';

export type LogStatus =
  | 'pending_transcription'
  | 'awaiting_review'
  | 'approved'
  | 'failed';

export type SegmentSource = 'webspeech' | 'webspeech_local' | 'whisper' | 'typed';

export type ItemOrigin = 'auto' | 'manual';

export type SttMode = 'hybrid' | 'local_only';

export interface Shed {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: number;
}

export interface Machine {
  id: string;
  shedId: string;
  machineNo: string;
  make: string | null;
  model: string | null;
  loomType: string | null;
  shedviewId: string | null;
  installedOn: string | null;
  active: boolean;
  createdAt: number;
}

export interface User {
  phone: string;
  name: string;
  role: Role;
  lang: Lang;
  active: boolean;
  createdAt: number;
}

export interface TaxonomyItemRecord {
  code: string;
  kind: 'action' | 'part';
  category: string;
  labelEn: string;
  labelHi: string;
  labelMr: string;
  unit: string | null;
  sortOrder: number;
  active: boolean;
  synonyms: string[];
}

export interface LogItemRecord {
  id: string;
  logId: string;
  code: string;
  qty: number | null;
  unit: string | null;
  origin: ItemOrigin;
}

export interface LogSegmentRecord {
  id: string;
  logId: string;
  seq: number;
  audioKey: string | null;
  durationMs: number | null;
  source: SegmentSource;
  transcript: string | null;
  confidence: number | null;
  transcribedAt: number | null;
}

export interface LogRecord {
  id: string;
  machineId: string;
  operatorPhone: string;
  status: LogStatus;
  captureLang: Lang;
  transcript: string | null;
  typedNote: string | null;
  clientCreatedAt: number;
  serverReceivedAt: number;
  approvedAt: number | null;
  retryCount: number;
  failReason: string | null;
}

export interface LogEditRecord {
  id: string;
  logId: string;
  adminPhone: string;
  field: 'transcript' | 'items';
  valueBefore: string;
  valueAfter: string;
  reason: string;
  editedAt: number;
}

export interface LogDetail extends LogRecord {
  machineNo: string;
  shedCode: string;
  shedName: string;
  operatorName: string;
  segments: LogSegmentRecord[];
  items: LogItemRecord[];
  edits: LogEditRecord[];
}
