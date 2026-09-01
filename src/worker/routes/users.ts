import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireSuperAdmin, requireAuth } from '../lib/middleware';
import { hashDerivedKey } from '../lib/auth';
import { mapUser } from '../lib/mappers';
import { setUserSheds } from '../lib/shed-access';

// Owner tier only: "Super admin is the one who creates the admins and the
// operators if needed" — account management does not belong to a
// shed-scoped admin at all, only to the tier with no scoping.
export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth, requireSuperAdmin);

userRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM users ORDER BY active DESC, name',
  ).all<Record<string, unknown>>();
  return c.json({ users: results.map(mapUser) });
});

userRoutes.get('/:phone/sheds', async (c) => {
  const phone = c.req.param('phone');
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

userRoutes.patch('/:phone', async (c) => {
  const phone = c.req.param('phone');
  const body = await c.req.json<{ active?: boolean; name?: string; shedIds?: string[] }>();

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
