export interface HistoryFilters {
  shedId?: string;
  machineId?: string;
  operatorPhone?: string;
  dateFrom?: number;
  dateTo?: number;
  code?: string;
}

/** Who is asking. A plain admin only ever sees their granted sheds — same
 * shed-scoping as everywhere else — and never a deleted log. Only the owner
 * tier can pass `includeDeleted`, and only the owner tier calls this with
 * `shedIds: 'all'` in the first place (see accessibleShedIds). */
export interface HistoryScope {
  shedIds: string[] | 'all';
  includeDeleted?: boolean;
}

const SELECT = `
  SELECT
    l.id AS log_id, l.client_created_at, l.transcript, l.typed_note, l.status,
    l.deleted_at, l.deleted_by,
    s.code AS shed_code, s.name AS shed_name, mc.machine_no,
    u.name AS operator_name, u.phone AS operator_phone,
    li.code AS item_code, li.qty, li.unit, li.origin,
    ti.label_en, ti.label_hi, ti.label_mr, ti.category
  FROM logs l
  JOIN machines mc ON mc.id = l.machine_id
  JOIN sheds s ON s.id = mc.shed_id
  JOIN users u ON u.phone = l.operator_phone
  LEFT JOIN log_items li ON li.log_id = l.id
  LEFT JOIN taxonomy_items ti ON ti.code = li.code
`;

function buildWhere(
  filters: HistoryFilters,
  scope: HistoryScope,
): { clause: string; binds: unknown[] } {
  const where: string[] = ["l.status = 'approved'"]; // history is the approved record, not drafts in flight
  const binds: unknown[] = [];

  where.push(scope.includeDeleted ? '1=1' : 'l.deleted_at IS NULL');

  if (scope.shedIds !== 'all') {
    if (scope.shedIds.length === 0) {
      where.push('0=1'); // no sheds granted: no rows, not "unfiltered"
    } else {
      where.push(`mc.shed_id IN (${scope.shedIds.map(() => '?').join(',')})`);
      binds.push(...scope.shedIds);
    }
  }

  if (filters.shedId) {
    where.push('mc.shed_id = ?');
    binds.push(filters.shedId);
  }
  if (filters.machineId) {
    where.push('l.machine_id = ?');
    binds.push(filters.machineId);
  }
  if (filters.operatorPhone) {
    where.push('l.operator_phone = ?');
    binds.push(filters.operatorPhone);
  }
  if (filters.dateFrom) {
    where.push('l.client_created_at >= ?');
    binds.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where.push('l.client_created_at <= ?');
    binds.push(filters.dateTo);
  }
  if (filters.code) {
    where.push('li.code = ?');
    binds.push(filters.code);
  }

  return { clause: where.join(' AND '), binds };
}

/** One row per log_item (CLAUDE.md phase 5: drops straight into a pivot
 * table), joined out to everything a supervisor wants to filter or read
 * without a second lookup. Paginated for the admin screen. */
export function buildHistoryQuery(
  filters: HistoryFilters,
  scope: HistoryScope,
  { page, pageSize }: { page: number; pageSize: number },
): { sql: string; binds: unknown[] } {
  const { clause, binds } = buildWhere(filters, scope);
  return {
    sql: `${SELECT} WHERE ${clause} ORDER BY l.client_created_at DESC LIMIT ? OFFSET ?`,
    binds: [...binds, pageSize, page * pageSize],
  };
}

/** Unpaginated, for CSV export of the whole filtered set. */
export function buildHistoryExportQuery(
  filters: HistoryFilters,
  scope: HistoryScope,
): { sql: string; binds: unknown[] } {
  const { clause, binds } = buildWhere(filters, scope);
  return {
    sql: `${SELECT} WHERE ${clause} ORDER BY l.client_created_at DESC LIMIT 20000`,
    binds,
  };
}
