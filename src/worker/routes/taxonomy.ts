import { Hono } from 'hono';
import type { AppEnv } from '../lib/middleware';
import { requireAdmin, requireAuth } from '../lib/middleware';
import { fetchTaxonomy, parseSynonyms } from '../lib/taxonomy';
import { buildSetClause } from '../lib/sql-update';

export const taxonomyRoutes = new Hono<AppEnv>();
taxonomyRoutes.use('*', requireAuth);

/** Client cache in Dexie refreshes from this. Any operator can read it. */
taxonomyRoutes.get('/', async (c) => {
  const items = await fetchTaxonomy(c.env.DB);
  return c.json({ items });
});

taxonomyRoutes.get('/all', requireAdmin, async (c) => {
  const items = await fetchTaxonomy(c.env.DB, { includeInactive: true });
  return c.json({ items });
});

interface TaxonomyBody {
  code: string;
  kind: 'action' | 'part';
  category: string;
  labelEn: string;
  labelHi: string;
  labelMr: string;
  unit?: string;
  synonyms: string; // comma separated, both scripts in one field
}

taxonomyRoutes.post('/', requireAdmin, async (c) => {
  const body = await c.req.json<TaxonomyBody>();
  if (!body.code || !body.kind || !body.labelEn) {
    return c.json({ error: 'code, kind and labelEn required' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO taxonomy_items (code, kind, category, label_en, label_hi, label_mr, unit, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 100, 1)`,
  )
    .bind(body.code, body.kind, body.category, body.labelEn, body.labelHi, body.labelMr, body.unit ?? null)
    .run();

  await writeSynonyms(c.env.DB, body.code, body.synonyms ?? '');

  return c.json({ ok: true }, 201);
});

taxonomyRoutes.patch('/:code', requireAdmin, async (c) => {
  const code = c.req.param('code');
  if (!code) return c.json({ error: 'code required' }, 400);
  const body = await c.req.json<Partial<TaxonomyBody> & { active?: boolean }>();

  const { setClause, binds } = buildSetClause({
    category: body.category,
    label_en: body.labelEn,
    label_hi: body.labelHi,
    label_mr: body.labelMr,
    unit: body.unit,
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  });

  if (setClause) {
    await c.env.DB.prepare(`UPDATE taxonomy_items SET ${setClause} WHERE code = ?`)
      .bind(...binds, code)
      .run();
  }

  if (body.synonyms !== undefined) {
    await c.env.DB.prepare('DELETE FROM taxonomy_synonyms WHERE code = ?').bind(code).run();
    await writeSynonyms(c.env.DB, code, body.synonyms ?? '');
  }

  return c.json({ ok: true });
});

async function writeSynonyms(db: D1Database, code: string, raw: string): Promise<void> {
  const synonyms = parseSynonyms(raw);
  if (synonyms.length === 0) return;
  await db.batch(
    synonyms.map(({ phrase, script }) =>
      db
        .prepare('INSERT OR IGNORE INTO taxonomy_synonyms (code, phrase, script) VALUES (?, ?, ?)')
        .bind(code, phrase, script),
    ),
  );
}
