import { mapTaxonomyItem } from './mappers';
import type { TaxonomyItemRecord } from '@shared/types';

export async function fetchTaxonomy(
  db: D1Database,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<TaxonomyItemRecord[]> {
  const itemsQuery = includeInactive
    ? 'SELECT * FROM taxonomy_items ORDER BY kind, sort_order, code'
    : 'SELECT * FROM taxonomy_items WHERE active = 1 ORDER BY kind, sort_order, code';
  const { results: itemRows } = await db.prepare(itemsQuery).all<Record<string, unknown>>();

  const { results: synRows } = await db
    .prepare('SELECT code, phrase FROM taxonomy_synonyms ORDER BY code, id')
    .all<{ code: string; phrase: string }>();

  const synonymsByCode = new Map<string, string[]>();
  for (const row of synRows) {
    const list = synonymsByCode.get(row.code) ?? [];
    list.push(row.phrase);
    synonymsByCode.set(row.code, list);
  }

  return itemRows.map((row) => mapTaxonomyItem(row, synonymsByCode.get(row.code as string) ?? []));
}

/** Comma separated field carrying both scripts in one box (DESIGN.md /
 * AGENTS.md admin taxonomy tab). Devanagari codepoints mark a phrase 'deva',
 * everything else 'latn'. */
export function parseSynonyms(raw: string): { phrase: string; script: 'deva' | 'latn' }[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((phrase) => ({
      phrase,
      script: /[ऀ-ॿ]/.test(phrase) ? ('deva' as const) : ('latn' as const),
    }));
}
