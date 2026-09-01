import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { mapShed } from '../lib/mappers';
import { accessibleShedIds } from '../lib/shed-access';
import { uuidv7 } from '@shared/id';

export const shedRoutes = new Hono<AppEnv>();
shedRoutes.use('*', requireAuth);

/** An operator only ever sees the sheds an admin granted them — never the
 * whole plant. Admins see everything, always. */
shedRoutes.get('/', async (c) => {
  const session = c.get('session');
  const allowed = await accessibleShedIds(c.env.DB, session);

  if (allowed === 'all') {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM sheds ORDER BY code',
    ).all<Record<string, unknown>>();
    return c.json({ sheds: results.map(mapShed) });
  }

  if (allowed.length === 0) return c.json({ sheds: [] });

  const placeholders = allowed.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM sheds WHERE id IN (${placeholders}) AND active = 1 ORDER BY code`,
  )
    .bind(...allowed)
    .all<Record<string, unknown>>();
  return c.json({ sheds: results.map(mapShed) });
});

shedRoutes.post('/', requireAdmin, async (c) => {
  const { code, name } = await c.req.json<{ code: string; name: string }>();
  if (!code || !name) return c.json({ error: 'code and name required' }, 400);

  const id = uuidv7();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO sheds (id, code, name, active, created_at) VALUES (?, ?, ?, 1, ?)',
  )
    .bind(id, code, name, now)
    .run();

  return c.json({ shed: { id, code, name, active: true, createdAt: now } }, 201);
});

shedRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; active?: boolean }>();

  if (body.name !== undefined) {
    await c.env.DB.prepare('UPDATE sheds SET name = ? WHERE id = ?').bind(body.name, id).run();
  }
  if (body.active !== undefined) {
    // A shed is its machines. Deactivating the shed but leaving 56 looms
    // marked active would leave them showing up in pickers and reports for a
    // shed that is supposed to be shut, so the state moves together.
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE sheds SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, id),
      c.env.DB.prepare('UPDATE machines SET active = ? WHERE shed_id = ?').bind(
        body.active ? 1 : 0,
        id,
      ),
    ]);
  }

  const row = await c.env.DB.prepare('SELECT * FROM sheds WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ shed: mapShed(row) });
});
