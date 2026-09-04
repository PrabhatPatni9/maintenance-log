import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { createSession, destroySession, fakeSaltFor, hashDerivedKey } from '../lib/auth';
import { mapUser } from '../lib/mappers';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/salt', async (c) => {
  const { phone } = await c.req.json<{ phone: string }>();
  if (!phone) return c.json({ error: 'phone required' }, 400);

  const row = await c.env.DB.prepare('SELECT pass_salt FROM users WHERE phone = ? AND active = 1')
    .bind(phone)
    .first<{ pass_salt: string }>();

  // A fake salt for unknown phones is returned with the same shape as a real
  // one, so this endpoint cannot be used to enumerate users.
  const salt = row?.pass_salt ?? (await fakeSaltFor(c.env, phone));
  return c.json({ salt });
});

authRoutes.post('/login', async (c) => {
  const { phone, derivedKey } = await c.req.json<{ phone: string; derivedKey: string }>();
  if (!phone || !derivedKey) return c.json({ error: 'phone and derivedKey required' }, 400);

  const row = await c.env.DB.prepare('SELECT * FROM users WHERE phone = ? AND active = 1')
    .bind(phone)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: 'invalid credentials' }, 401);

  const hash = await hashDerivedKey(derivedKey);
  if (hash !== row.pass_hash) return c.json({ error: 'invalid credentials' }, 401);

  const user = mapUser(row);
  await createSession(c, {
    phone: user.phone,
    name: user.name,
    role: user.role,
    isOperator: user.isOperator,
    isUtility: user.isUtility,
    lang: user.lang,
  });
  return c.json({ user });
});

authRoutes.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});
