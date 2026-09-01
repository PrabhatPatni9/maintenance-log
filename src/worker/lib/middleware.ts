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

/** Shed-scoped supervisor tier or above — manages machines and taxonomy
 * within sheds they were granted, reviews/soft-deletes history. */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const session = c.get('session');
  if (session.role !== 'admin' && session.role !== 'super_admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  await next();
}

/** Owner tier only — creates every account, creates/removes sheds, sees
 * every shed with no scoping, and is the only role that can permanently
 * purge a log or restore one an admin soft-deleted. */
export async function requireSuperAdmin(c: Context<AppEnv>, next: Next) {
  const session = c.get('session');
  if (session.role !== 'super_admin') return c.json({ error: 'forbidden' }, 403);
  await next();
}
