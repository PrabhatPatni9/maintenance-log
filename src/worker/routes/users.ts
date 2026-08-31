import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { hashDerivedKey } from '../lib/auth';
import { mapUser } from '../lib/mappers';
import { setUserSheds } from '../lib/shed-access';

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth, requireAdmin);

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
 * `shedIds` is which sheds an operator can see at all (CLAUDE.md's access
 * model). Ignored for admins, who always see every shed.
 */
userRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    phone: string;
    name: string;
    role: 'admin' | 'operator';
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

  await c.env.DB.prepare(
    `INSERT INTO users (phone, name, role, lang, pass_hash, pass_salt, active, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(body.phone, body.name, body.role, body.lang, passHash, body.salt, now, session.phone)
    .run();

  if (body.role === 'operator' && body.shedIds?.length) {
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
