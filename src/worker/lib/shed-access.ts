import type { SessionRecord } from './env';

/** Only the owner tier is exempt from user_sheds and sees every shed with no
 * scoping. A plain `admin` is shed-scoped exactly like an operator — the
 * same user_sheds grant, just with machine/taxonomy/history management
 * rights inside those sheds instead of only being able to record logs. */
export async function accessibleShedIds(
  db: D1Database,
  session: SessionRecord,
): Promise<string[] | 'all'> {
  if (session.role === 'super_admin') return 'all';
  const { results } = await db
    .prepare('SELECT shed_id FROM user_sheds WHERE user_phone = ?')
    .bind(session.phone)
    .all<{ shed_id: string }>();
  return results.map((r) => r.shed_id);
}

export async function canAccessShed(
  db: D1Database,
  session: SessionRecord,
  shedId: string,
): Promise<boolean> {
  if (session.role === 'super_admin') return true;
  const row = await db
    .prepare('SELECT 1 FROM user_sheds WHERE user_phone = ? AND shed_id = ?')
    .bind(session.phone, shedId)
    .first();
  return Boolean(row);
}

export async function setUserSheds(
  db: D1Database,
  userPhone: string,
  shedIds: string[],
): Promise<void> {
  const statements = [
    db.prepare('DELETE FROM user_sheds WHERE user_phone = ?').bind(userPhone),
    ...shedIds.map((shedId) =>
      db
        .prepare('INSERT OR IGNORE INTO user_sheds (user_phone, shed_id) VALUES (?, ?)')
        .bind(userPhone, shedId),
    ),
  ];
  await db.batch(statements);
}
