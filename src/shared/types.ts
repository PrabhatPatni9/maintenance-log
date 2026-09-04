/**
 * The contract between the Worker and the web app. Anything used by both
 * sides lives here and nowhere else (CLAUDE.md section 4).
 */

export type Lang = 'en' | 'hi' | 'mr';

/**
 * Four tiers. `operator` records maintenance logs. `utility_operator` is the
 * electrician's tier: shed-scoped the same way as `operator` (same
 * `user_sheds` grant), but logs daily meter readings (kWh/PF) instead of
 * maintenance notes — a separate job, not a variant of the operator one.
 * `admin` is the shed-level supervisor: manages meters and taxonomy within
 * sheds they were granted, can act as either operator or utility_operator
 * themselves when one is absent, sees history and the dashboard for their
 * own sheds. `super_admin` is the owner tier: creates every account
 * (including other admins), creates/removes sheds and machines, sees every
 * shed with no scoping, and is the only role that can permanently purge a
 * log or restore one an admin soft-deleted.
 */
export type Role = 'super_admin' | 'admin' | 'utility_operator' | 'operator';

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
  meterId: string | null;
  active: boolean;
  createdAt: number;
}

/** One electrical meter, belonging to one shed. A machine is wired to at
 * most one meter (see Machine.meterId) — the meter is shared across
 * however many machines sit on that circuit. */
export interface Meter {
  id: string;
  shedId: string;
  code: string;
  name: string | null;
  active: boolean;
  createdAt: number;
}

/** One day's reading for one meter, as read off the physical meter — always
 * cumulative kWh, never a delta. Daily consumption is derived, not stored;
 * see MeterConsumptionRow. */
export interface MeterReading {
  id: string;
  meterId: string;
  readingDate: string; // 'YYYY-MM-DD'
  kwhReading: number;
  pfReading: number | null;
  note: string | null;
  recordedBy: string;
  recordedAt: number;
}

export interface MeterReadingEditRecord {
  id: string;
  readingId: string;
  adminPhone: string;
  field: 'kwh_reading' | 'pf_reading';
  valueBefore: string | null;
  valueAfter: string | null;
  reason: string;
  editedAt: number;
}

/** One meter, one day, with consumption already derived (today's kWh minus
 * the most recent earlier reading) — what the dashboard graph and the
 * per-machine split both read from. `machineCount` is how many machines
 * share this meter, so the UI can show the equal-split per-machine number
 * without a second round trip. */
export interface MeterConsumptionRow {
  meterId: string;
  meterCode: string;
  shedId: string;
  shedCode: string;
  readingDate: string;
  kwhReading: number;
  pfReading: number | null;
  kwhConsumed: number | null; // null for a meter's first-ever reading — nothing to subtract from
  machineCount: number;
  kwhPerMachine: number | null;
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
