import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAuth } from '../lib/middleware';
import { hashDerivedKey, updateSessionCache } from '../lib/auth';

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireAuth);

meRoutes.get('/', (c) => c.json({ user: c.get('session') }));

/** Self-service name edit. Never role, sheds, or phone — those stay
 * admin-only (users.ts), same boundary as everywhere else in the app. */
meRoutes.patch('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  await c.env.DB.prepare('UPDATE users SET name = ? WHERE phone = ?').bind(name, session.phone).run();
  await updateSessionCache(c, { name });

  return c.json({ user: { ...session, name } });
});

/**
 * Same client-side PBKDF2 derivation as login and admin-created accounts
 * (CLAUDE.md section 9 — the server never sees a plaintext password). The
 * current password is required and re-verified here rather than trusting
 * the session cookie alone: an operator's session can sit logged in for 90
 * days on a shared shed-floor phone, and without this, anyone who picked up
 * an unlocked phone could lock the real owner out by silently setting a new
 * password.
 */
meRoutes.post('/password', async (c) => {
  const session = c.get('session');
  const body = await c.req.json<{ oldDerivedKey: string; newSalt: string; newDerivedKey: string }>();
  if (!body.oldDerivedKey || !body.newSalt || !body.newDerivedKey) {
    return c.json({ error: 'missing fields' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT pass_hash FROM users WHERE phone = ?')
    .bind(session.phone)
    .first<{ pass_hash: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);

  const oldHash = await hashDerivedKey(body.oldDerivedKey);
  if (oldHash !== row.pass_hash) return c.json({ error: 'current password is wrong' }, 401);

  const newHash = await hashDerivedKey(body.newDerivedKey);
  await c.env.DB.prepare('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE phone = ?')
    .bind(body.newSalt, newHash, session.phone)
    .run();

  return c.json({ ok: true });
});
