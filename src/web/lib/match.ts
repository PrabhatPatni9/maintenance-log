import { compile, match, type CompiledTaxonomy, type Match } from '@shared/match';
import { toMatchable } from '@shared/taxonomy';
import { db } from './db';
import { api } from './api';
import type { TaxonomyItemRecord } from '@shared/types';

let cached: CompiledTaxonomy | null = null;

/** Refresh the Dexie taxonomy cache from the server. Safe to call whenever
 * there is network; a failure just means the existing cache keeps serving
 * (CLAUDE.md section 8: matching must work fully offline). */
export async function refreshTaxonomy(): Promise<void> {
  const { items } = await api.get<{ items: TaxonomyItemRecord[] }>('/taxonomy');
  await db.transaction('rw', db.taxonomy, async () => {
    await db.taxonomy.clear();
    await db.taxonomy.bulkPut(
      items.map((i) => ({
        code: i.code,
        kind: i.kind,
        category: i.category,
        labelEn: i.labelEn,
        labelHi: i.labelHi,
        labelMr: i.labelMr,
        unit: i.unit,
        sortOrder: i.sortOrder,
        active: i.active,
        synonyms: i.synonyms,
      })),
    );
  });
  cached = null; // force recompile on next getMatcher()
}

/**
 * On a fresh device, refreshTaxonomy() fires at login but is not awaited
 * before the operator can start recording (CLAUDE.md: recording never
 * depends on the network). On patchy 4G that fetch can easily still be in
 * flight when the operator finishes their first note, and if getMatcher()
 * runs in that window it would compile an EMPTY taxonomy and — because
 * `cached` only gets invalidated by refreshTaxonomy() finishing, and only if
 * it finishes after this call started — that empty result could stay
 * cached for the rest of the session on a bad enough connection. Every
 * match after that point silently returns nothing, on every language, not
 * just the one attempted. This is likely the actual "works, but flaky"
 * failure reported — not a bad regex, an empty vocabulary at match time.
 * Fix: never treat an empty result as valid enough to cache.
 */
export async function getMatcher(): Promise<CompiledTaxonomy> {
  if (cached) return cached;
  const items = await db.taxonomy.toArray();
  const compiled = compile(toMatchable(items as unknown as TaxonomyItemRecord[]));
  if (items.length > 0) cached = compiled;
  return compiled;
}

export async function getAllTaxonomy() {
  return db.taxonomy.orderBy('sortOrder').toArray();
}

export async function matchTranscript(transcript: string): Promise<Match[]> {
  const taxonomy = await getMatcher();
  return match(transcript, taxonomy);
}
