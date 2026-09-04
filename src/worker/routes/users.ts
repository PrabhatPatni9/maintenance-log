import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { hashDerivedKey } from '../lib/auth';
import { mapUser } from '../lib/mappers';
import { accessibleShedIds, setUserSheds } from '../lib/shed-access';
import type { SessionRecord } from '../lib/env';

/**
 * Owner tier manages every account. A shed-scoped admin can now add
 * operators too — "distribute" a slice of the sheds they were granted to
 * someone doing the recording — but never another admin or the owner tier,
 * and never an operator outside their own roster. Every route below trusts
 * nothing from the client about role or shed scope beyond what the caller's
 * own session already proves.
 */
export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth, requireAdmin);

/** True for the accounts a shed-scoped admin is allowed to see or touch at
 * all: operators they personally created. Everyone else's account — other
 * admins, the owner tier, operators someone else added — is invisible to
 * them here, same as CLAUDE.md's "admin has shed-level access" model applied
 * to people, not just sheds. The owner tier has no such restriction. */
function canManage(session: SessionRecord, target: { role: string; created_by: unknown }): boolean {
  if (session.role === 'super_admin') return true;
  return target.role === 'operator' && target.created_by === session.phone;
}

/** Every requested shed must already be one the calling admin holds — an
 * admin can only ever distribute a subset of their own access, never grant
 * a shed they cannot see themselves. Returns the offending id, or null if
 * every id checks out. */
async function firstShedOutsideGrant(
  db: D1Database,
  session: SessionRecord,
  shedIds: string[],
): Promise<string | null> {
  if (session.role === 'super_admin') return null;
  const allowed = new Set(await accessibleShedIds(db, session) as string[]);
  return shedIds.find((id) => !allowed.has(id)) ?? null;
}

userRoutes.get('/', async (c) => {
  const session = c.get('session');
  const stmt =
    session.role === 'super_admin'
      ? c.env.DB.prepare('SELECT * FROM users ORDER BY active DESC, name')
      : c.env.DB.prepare(
          "SELECT * FROM users WHERE role = 'operator' AND created_by = ? ORDER BY active DESC, name",
        ).bind(session.phone);
  const { results } = await stmt.all<Record<string, unknown>>();
  return c.json({ users: results.map(mapUser) });
});

userRoutes.get('/:phone/sheds', async (c) => {
  const phone = c.req.param('phone');
  const session = c.get('session');

  const target = await c.env.DB.prepare('SELECT role, created_by FROM users WHERE phone = ?')
    .bind(phone)
    .first<{ role: string; created_by: unknown }>();
  if (!target || !canManage(session, target)) return c.json({ error: 'forbidden' }, 403);

  const { results } = await c.env.DB.prepare('SELECT shed_id FROM user_sheds WHERE user_phone = ?')
    .bind(phone)
    .all<{ shed_id: string }>();
  return c.json({ shedIds: results.map((r) => r.shed_id) });
});

/**
 * The admin's browser derives the initial password the same way an
 * operator's does at login (PBKDF2, generateSaltB64 + deriveKeyB64 from
 * src/web/lib/crypto.ts). The server only ever sees `derivedKey`, never the
 * plaintext password, and does the same one SHA-256 it does at login time.
 *
 * `shedIds` is which sheds a shed-scoped user can see at all (CLAUDE.md's
 * access model) — applies to 'admin' now too, not just 'operator', since a
 * plain admin is scoped exactly like an operator. Ignored for super_admin,
 * who always sees every shed with no grant needed.
 *
 * `role='super_admin'` is not a legal DB value (see migration 0004) — it is
 * stored as role='admin' plus is_super_admin=1, and mapUser folds that back
 * into the three-way Role everywhere else in the app.
 */
userRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    phone: string;
    name: string;
    role: 'super_admin' | 'admin' | 'operator';
    lang: 'en' | 'hi' | 'mr';
    salt: string;
    derivedKey: string;
    shedIds?: string[];
  }>();
  if (!body.phone || !body.name || !body.role || !body.salt || !body.derivedKey) {
    return c.json({ error: 'missing fields' }, 400);
  }

  const session = c.get('session');

  // A shed-scoped admin can only ever create an operator — never another
  // admin, and never the owner tier. This is the actual permission
  // boundary; hiding the role picker in the UI is a courtesy, not the
  // guard, since a request can always be handwritten.
  if (session.role !== 'super_admin' && body.role !== 'operator') {
    return c.json({ error: 'admins may only add operators' }, 403);
  }

  const outsideGrant = await firstShedOutsideGrant(c.env.DB, session, body.shedIds ?? []);
  if (outsideGrant) {
    return c.json({ error: `shed ${outsideGrant} is not one of your own` }, 403);
  }

  const passHash = await hashDerivedKey(body.derivedKey);
  const now = Date.now();
  const isSuperAdmin = body.role === 'super_admin';
  const dbRole = isSuperAdmin ? 'admin' : body.role;

  await c.env.DB.prepare(
    `INSERT INTO users (phone, name, role, lang, pass_hash, pass_salt, active, created_at, created_by, is_super_admin)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(body.phone, body.name, dbRole, body.lang, passHash, body.salt, now, session.phone, isSuperAdmin ? 1 : 0)
    .run();

  if ((body.role === 'operator' || body.role === 'admin') && body.shedIds?.length) {
    await setUserSheds(c.env.DB, body.phone, body.shedIds);
  }

  return c.json(
    { user: { phone: body.phone, name: body.name, role: body.role, lang: body.lang, active: true, createdAt: now } },
    201,
  );
});

/**
 * The forgotten-password path: an admin sets a new password for someone
 * they manage without needing the old one (that is the whole point — the
 * operator forgot it). Same client-side PBKDF2 derivation and same
 * canManage boundary as everywhere else here: the owner tier can reset
 * anyone, a shed-scoped admin only an operator they personally created.
 * This never touches shed access or role — only pass_salt/pass_hash.
 */
userRoutes.post('/:phone/reset-password', async (c) => {
  const phone = c.req.param('phone');
  const session = c.get('session');
  const body = await c.req.json<{ salt: string; derivedKey: string }>();
  if (!body.salt || !body.derivedKey) return c.json({ error: 'missing fields' }, 400);

  const target = await c.env.DB.prepare('SELECT role, created_by FROM users WHERE phone = ?')
    .bind(phone)
    .first<{ role: string; created_by: unknown }>();
  if (!target) return c.json({ error: 'not found' }, 404);
  if (!canManage(session, target)) return c.json({ error: 'forbidden' }, 403);

  const passHash = await hashDerivedKey(body.derivedKey);
  await c.env.DB.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE phone = ?')
    .bind(body.salt, passHash, phone)
    .run();

  return c.json({ ok: true });
});

userRoutes.patch('/:phone', async (c) => {
  const phone = c.req.param('phone');
  const session = c.get('session');
  const body = await c.req.json<{ active?: boolean; name?: string; shedIds?: string[] }>();

  const target = await c.env.DB.prepare('SELECT role, created_by FROM users WHERE phone = ?')
    .bind(phone)
    .first<{ role: string; created_by: unknown }>();
  if (!target) return c.json({ error: 'not found' }, 404);
  if (!canManage(session, target)) return c.json({ error: 'forbidden' }, 403);

  if (body.shedIds !== undefined) {
    const outsideGrant = await firstShedOutsideGrant(c.env.DB, session, body.shedIds);
    if (outsideGrant) return c.json({ error: `shed ${outsideGrant} is not one of your own` }, 403);
  }

  if (body.active !== undefined) {
    await c.env.DB.prepare('UPDATE users SET active = ? WHERE phone = ?')
      .bind(body.active ? 1 : 0, phone)
      .run();
  }
  if (body.name !== undefined) {
    await c.env.DB.prepare('UPDATE users SET name = ? WHERE phone = ?').bind(body.name, phone).run();
  }
  if (body.shedIds !== undefined) {
    await setUserSheds(c.env.DB, phone, body.shedIds);
  }

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE phone = ?')
    .bind(phone)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ user: mapUser(row) });
});
