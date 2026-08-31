import type { Context, Next } from 'hono';
import type { AppEnv } from './env';
import { resolveSession } from './auth';

export type { AppEnv };

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const session = await resolveSession(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  c.set('session', session);
  await next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const session = c.get('session');
  if (session.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
}
