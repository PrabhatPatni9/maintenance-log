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

export async function getMatcher(): Promise<CompiledTaxonomy> {
  if (cached) return cached;
  const items = await db.taxonomy.toArray();
  cached = compile(toMatchable(items as unknown as TaxonomyItemRecord[]));
  return cached;
}

export async function getAllTaxonomy() {
  return db.taxonomy.orderBy('sortOrder').toArray();
}

export async function matchTranscript(transcript: string): Promise<Match[]> {
  const taxonomy = await getMatcher();
  return match(transcript, taxonomy);
}
