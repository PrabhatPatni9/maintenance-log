import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAuth, requireSuperAdmin } from '../lib/middleware';
import { mapWebhook } from '../lib/mappers';
import { uuidv7 } from '@shared/id';
import { hmacSha256Hex } from '@shared/crypto';

/**
 * Owner tier only, by explicit product decision — a webhook URL is an exit
 * door for shed data to anywhere on the internet, so this is deliberately
 * not something a shed-scoped admin can wire up even for their own shed.
 */
export const webhookRoutes = new Hono<AppEnv>();
webhookRoutes.use('*', requireAuth, requireSuperAdmin);

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}

webhookRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, scope_type, scope_id, url, active, created_by, created_at, last_fired_at, last_status, last_error FROM webhooks ORDER BY created_at DESC',
  ).all<Record<string, unknown>>();
  return c.json({ webhooks: results.map(mapWebhook) });
});

/** `secret` is returned exactly once, here — the same "copy it now, it's
 * gone after this" treatment as an admin-created password. Every later read
 * (GET /) omits the column entirely, so there's nothing to leak later even
 * by accident. */
webhookRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    scopeType: 'global' | 'shed' | 'machine';
    scopeId?: string | null;
    url: string;
  }>();
  if (!body.scopeType || !body.url) return c.json({ error: 'scopeType and url required' }, 400);
  if (body.scopeType !== 'global' && !body.scopeId) {
    return c.json({ error: 'scopeId required for a shed or machine scope' }, 400);
  }
  try {
    new URL(body.url);
  } catch {
    return c.json({ error: 'url must be a valid URL' }, 400);
  }

  if (body.scopeType === 'shed') {
    const shed = await c.env.DB.prepare('SELECT id FROM sheds WHERE id = ?').bind(body.scopeId).first();
    if (!shed) return c.json({ error: 'shed not found' }, 404);
  } else if (body.scopeType === 'machine') {
    const machine = await c.env.DB.prepare('SELECT id FROM machines WHERE id = ?').bind(body.scopeId).first();
    if (!machine) return c.json({ error: 'machine not found' }, 404);
  }

  const session = c.get('session');
  const id = uuidv7();
  const secret = randomSecret();
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO webhooks (id, scope_type, scope_id, url, secret, active, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, body.scopeType, body.scopeType === 'global' ? null : body.scopeId, body.url, secret, session.phone, now)
    .run();

  const row = await c.env.DB.prepare(
    'SELECT id, scope_type, scope_id, url, active, created_by, created_at, last_fired_at, last_status, last_error FROM webhooks WHERE id = ?',
  )
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ webhook: mapWebhook(row!), secret }, 201);
});

webhookRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ active?: boolean; url?: string }>();

  const existing = await c.env.DB.prepare('SELECT id FROM webhooks WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'not found' }, 404);

  if (body.url !== undefined) {
    try {
      new URL(body.url);
    } catch {
      return c.json({ error: 'url must be a valid URL' }, 400);
    }
    await c.env.DB.prepare('UPDATE webhooks SET url = ? WHERE id = ?').bind(body.url, id).run();
  }
  if (body.active !== undefined) {
    await c.env.DB.prepare('UPDATE webhooks SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, id).run();
  }

  const row = await c.env.DB.prepare(
    'SELECT id, scope_type, scope_id, url, active, created_by, created_at, last_fired_at, last_status, last_error FROM webhooks WHERE id = ?',
  )
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({ webhook: mapWebhook(row!) });
});

webhookRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/** A dry-run ping so the super admin can confirm their Sheet/script is
 * actually receiving deliveries without waiting for a real log or reading —
 * same signing as a real delivery, just with `event: 'test'` and made-up
 * data so nothing downstream mistakes it for a real record. Sent straight
 * to this one webhook rather than through fireWebhooks' scope matching,
 * which would need a real shed/machine id to match against and could miss
 * a machine-scoped webhook entirely. */
webhookRoutes.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  const webhook = await c.env.DB.prepare('SELECT url, secret FROM webhooks WHERE id = ?')
    .bind(id)
    .first<{ url: string; secret: string }>();
  if (!webhook) return c.json({ error: 'not found' }, 404);

  const body = JSON.stringify({
    event: 'test',
    firedAt: Date.now(),
    data: { message: 'This is a test delivery from Ratanmoti Maintenance.' },
  });

  let status: number | null = null;
  let error: string | null = null;
  try {
    const signature = await hmacSha256Hex(webhook.secret, body);
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-event': 'test',
        'x-webhook-signature': `sha256=${signature}`,
      },
      body,
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : 'delivery failed';
  }

  const now = Date.now();
  await c.env.DB.prepare('UPDATE webhooks SET last_fired_at = ?, last_status = ?, last_error = ? WHERE id = ?')
    .bind(now, status, error, id)
    .run();

  return c.json({ lastFiredAt: now, lastStatus: status, lastError: error });
});
