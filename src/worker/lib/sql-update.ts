/** Builds a `col = ?` SET clause plus bind values from only the fields that
 * are actually present, so a PATCH only ever touches what was sent. */
export function buildSetClause(fields: Record<string, unknown>): { setClause: string; binds: unknown[] } {
  const cols: string[] = [];
  const binds: unknown[] = [];
  for (const [col, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    cols.push(`${col} = ?`);
    binds.push(value);
  }
  return { setClause: cols.join(', '), binds };
}
