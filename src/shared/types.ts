/**
 * The contract between the Worker and the web app. Anything used by both
 * sides lives here and nowhere else (CLAUDE.md section 4).
 */

export type Lang = 'en' | 'hi' | 'mr';

/**
 * Three tiers, not two. `operator` records logs. `admin` is the shed-level
 * supervisor: manages machines within sheds they were granted, same
 * shed-scoping model as an operator (via user_sheds), can soft-delete a
 * bogus log from view. `super_admin` is the owner tier: creates every
 * account (including other admins), creates/removes sheds, sees every shed
 * with no scoping, and is the only role that can permanently purge a log or
 * restore one an admin soft-deleted.
 */
export type Role = 'super_admin' | 'admin' | 'operator';

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

/** A log plus the machine/shed it belongs to and the pills it carries — what
 * the home screen's "today's logs" list actually needs to be useful at a
 * glance instead of a bare transcript string. Returned by GET /api/logs. */
export interface LogSummary extends LogRecord {
  machineNo: string;
  shedCode: string;
  shedName: string;
  items: LogItemRecord[];
}

/** One machine's maintenance history, whoever recorded each entry — the
 * shed-pick-then-machine-pick-then-see-everything flow (CLAUDE.md-adjacent:
 * the record belongs to the loom, not to whichever operator was holding the
 * phone that day). Returned by GET /api/machines/:id/history. */
export interface MachineHistoryEntry {
  id: string;
  operatorPhone: string;
  operatorName: string;
  clientCreatedAt: number;
  transcript: string | null;
  typedNote: string | null;
  items: LogItemRecord[];
}

export interface MachineHistoryResponse {
  machine: Machine;
  days: number;
  logs: MachineHistoryEntry[];
}

/** An operator's own footprint in one shed — "Shed A: how many machines have
 * I worked on" — the quick answer a search hands back without walking the
 * shed → machine → history flow by hand. Returned by GET /api/sheds/:id/stats. */
export interface ShedStats {
  machinesWorkedOn: number;
  logCount: number;
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
