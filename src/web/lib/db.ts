import Dexie, { type EntityTable } from 'dexie';
import type { ItemOrigin, Lang, SegmentSource } from '@shared/types';

/**
 * IndexedDB, not localStorage: it survives app close, phone restart and
 * browser cache clears (CLAUDE.md section 3). This is the whole outbox.
 * Every row here is safe even with the network off for the app's entire
 * lifetime.
 */

export interface OutboxLog {
  id: string; // client generated UUIDv7, doubles as the server primary key
  machineId: string;
  operatorPhone: string;
  captureLang: Lang;
  transcript: string | null;
  typedNote: string | null;
  clientCreatedAt: number;
  status: 'draft' | 'queued' | 'uploading' | 'synced' | 'error';
  syncAttempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export interface OutboxSegment {
  id: string;
  logId: string;
  seq: number;
  audioBlob: Blob;
  durationMs: number;
  source: SegmentSource;
  transcript: string | null;
  confidence: number | null;
  uploaded: 0 | 1; // Dexie can't index booleans well; 0/1 for the pending-upload index
  audioKey: string | null;
}

export interface OutboxItem {
  id: string;
  logId: string;
  code: string;
  qty: number | null;
  unit: string | null;
  origin: ItemOrigin;
}

export interface CachedTaxonomyItem {
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

export interface CachedMachine {
  id: string;
  shedId: string;
  shedCode: string;
  shedName: string;
  machineNo: string;
  active: boolean;
}

export interface KVRow {
  key: string;
  value: unknown;
}

class AppDB extends Dexie {
  outboxLogs!: EntityTable<OutboxLog, 'id'>;
  outboxSegments!: EntityTable<OutboxSegment, 'id'>;
  outboxItems!: EntityTable<OutboxItem, 'id'>;
  taxonomy!: EntityTable<CachedTaxonomyItem, 'code'>;
  machines!: EntityTable<CachedMachine, 'id'>;
  kv!: EntityTable<KVRow, 'key'>;

  constructor() {
    super('ratanmoti-maintenance');
    this.version(1).stores({
      outboxLogs: 'id, status, nextAttemptAt',
      outboxSegments: 'id, logId, uploaded, [logId+seq]',
      outboxItems: 'id, logId, [logId+code]',
      taxonomy: 'code, kind, active, sortOrder',
      machines: 'id, shedId, machineNo, active',
      kv: 'key',
    });
  }
}

export const db = new AppDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
