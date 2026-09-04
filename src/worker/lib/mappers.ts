import type {
  ItemOrigin,
  Lang,
  LogEditRecord,
  LogItemRecord,
  LogRecord,
  LogSegmentRecord,
  LogStatus,
  Machine,
  Meter,
  MeterReading,
  MeterReadingEditRecord,
  Role,
  SegmentSource,
  Shed,
  TaxonomyItemRecord,
  User,
  Webhook,
  WebhookScope,
} from '@shared/types';

// D1 rows come back snake_case; the shared contract is camelCase. These
// mappers are the only place that boundary is crossed.

export function mapShed(r: Record<string, unknown>): Shed {
  return {
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    active: Boolean(r.active),
    createdAt: r.created_at as number,
  };
}

export function mapMachine(r: Record<string, unknown>): Machine {
  return {
    id: r.id as string,
    shedId: r.shed_id as string,
    machineNo: r.machine_no as string,
    make: (r.make as string) ?? null,
    model: (r.model as string) ?? null,
    loomType: (r.loom_type as string) ?? null,
    shedviewId: (r.shedview_id as string) ?? null,
    installedOn: (r.installed_on as string) ?? null,
    meterId: (r.meter_id as string) ?? null,
    active: Boolean(r.active),
    createdAt: r.created_at as number,
  };
}

export function mapMeter(r: Record<string, unknown>): Meter {
  return {
    id: r.id as string,
    shedId: r.shed_id as string,
    code: r.code as string,
    name: (r.name as string) ?? null,
    active: Boolean(r.active),
    createdAt: r.created_at as number,
  };
}

export function mapMeterReading(r: Record<string, unknown>): MeterReading {
  return {
    id: r.id as string,
    meterId: r.meter_id as string,
    readingDate: r.reading_date as string,
    kwhReading: r.kwh_reading as number,
    pfReading: (r.pf_reading as number) ?? null,
    note: (r.note as string) ?? null,
    recordedBy: r.recorded_by as string,
    recordedAt: r.recorded_at as number,
  };
}

export function mapMeterReadingEdit(r: Record<string, unknown>): MeterReadingEditRecord {
  return {
    id: r.id as string,
    readingId: r.reading_id as string,
    adminPhone: r.admin_phone as string,
    field: r.field as 'kwh_reading' | 'pf_reading',
    valueBefore: (r.value_before as string) ?? null,
    valueAfter: (r.value_after as string) ?? null,
    reason: r.reason as string,
    editedAt: r.edited_at as number,
  };
}

/**
 * `role` is 'admin' | 'operator' at the DB level — `super_admin` could not be
 * added as a CHECK value without recreating the users table, which D1
 * refuses while other tables hold a foreign key into it (see migration
 * 0004's comment). The owner tier is `role='admin'` + `is_super_admin=1`.
 * `is_operator`/`is_utility` are independent job flags on the `operator`
 * tier (migration 0006) — admin and super_admin always report both true,
 * since either can stand in for an absent operator or electrician. This
 * mapper is the one place that folds the DB columns back into the app's
 * three-way Role plus its two capability flags.
 */
export function mapUser(r: Record<string, unknown>): User {
  const dbRole = r.role as 'admin' | 'operator';
  const role: Role = dbRole === 'admin' && Boolean(r.is_super_admin) ? 'super_admin' : dbRole;
  return {
    phone: r.phone as string,
    name: r.name as string,
    role,
    isOperator: role === 'operator' ? Boolean(r.is_operator) : true,
    isUtility: role === 'operator' ? Boolean(r.is_utility) : true,
    lang: r.lang as Lang,
    active: Boolean(r.active),
    createdAt: r.created_at as number,
  };
}

/** `secret` is never read back from the row here — see webhooks.ts's list
 * route, which selects every column except it. */
export function mapWebhook(r: Record<string, unknown>): Webhook {
  return {
    id: r.id as string,
    scopeType: r.scope_type as WebhookScope,
    scopeId: (r.scope_id as string | null) ?? null,
    url: r.url as string,
    active: Boolean(r.active),
    createdBy: r.created_by as string,
    createdAt: r.created_at as number,
    lastFiredAt: (r.last_fired_at as number | null) ?? null,
    lastStatus: (r.last_status as number | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
  };
}

export function mapTaxonomyItem(
  r: Record<string, unknown>,
  synonyms: string[],
): TaxonomyItemRecord {
  return {
    code: r.code as string,
    kind: r.kind as 'action' | 'part',
    category: r.category as string,
    labelEn: r.label_en as string,
    labelHi: r.label_hi as string,
    labelMr: r.label_mr as string,
    unit: (r.unit as string) ?? null,
    sortOrder: r.sort_order as number,
    active: Boolean(r.active),
    synonyms,
  };
}

export function mapLog(r: Record<string, unknown>): LogRecord {
  return {
    id: r.id as string,
    machineId: r.machine_id as string,
    operatorPhone: r.operator_phone as string,
    status: r.status as LogStatus,
    captureLang: r.capture_lang as Lang,
    transcript: (r.transcript as string) ?? null,
    typedNote: (r.typed_note as string) ?? null,
    clientCreatedAt: r.client_created_at as number,
    serverReceivedAt: r.server_received_at as number,
    approvedAt: (r.approved_at as number) ?? null,
    retryCount: r.retry_count as number,
    failReason: (r.fail_reason as string) ?? null,
  };
}

export function mapSegment(r: Record<string, unknown>): LogSegmentRecord {
  return {
    id: r.id as string,
    logId: r.log_id as string,
    seq: r.seq as number,
    audioKey: (r.audio_key as string) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
    source: r.source as SegmentSource,
    transcript: (r.transcript as string) ?? null,
    confidence: (r.confidence as number) ?? null,
    transcribedAt: (r.transcribed_at as number) ?? null,
  };
}

export function mapItem(r: Record<string, unknown>): LogItemRecord {
  return {
    id: r.id as string,
    logId: r.log_id as string,
    code: r.code as string,
    qty: (r.qty as number) ?? null,
    unit: (r.unit as string) ?? null,
    origin: r.origin as ItemOrigin,
  };
}

export function mapEdit(r: Record<string, unknown>): LogEditRecord {
  return {
    id: r.id as string,
    logId: r.log_id as string,
    adminPhone: r.admin_phone as string,
    field: r.field as 'transcript' | 'items',
    valueBefore: r.value_before as string,
    valueAfter: r.value_after as string,
    reason: r.reason as string,
    editedAt: r.edited_at as number,
  };
}
