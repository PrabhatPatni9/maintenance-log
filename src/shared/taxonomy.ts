import type { TaxonomyItem } from './match';
import type { Lang, TaxonomyItemRecord } from './types';

/** Shape of data/taxonomy.seed.json, and of the seed script's raw input. */
export interface TaxonomySeedEntry {
  code: string;
  category: string;
  label_en: string;
  label_hi: string;
  label_mr: string;
  unit?: string;
  synonyms: string[];
}

export interface TaxonomySeed {
  actions: TaxonomySeedEntry[];
  parts: TaxonomySeedEntry[];
}

/** Flatten a `TaxonomyItemRecord[]` (as returned by GET /api/taxonomy) into
 * the shape `src/shared/match.ts` compiles against. */
export function toMatchable(items: TaxonomyItemRecord[]): TaxonomyItem[] {
  return items
    .filter((i) => i.active)
    .map((i) => ({ code: i.code, kind: i.kind, synonyms: i.synonyms }));
}

export function labelFor(item: TaxonomyItemRecord, lang: Lang): string {
  if (lang === 'hi') return item.labelHi;
  if (lang === 'mr') return item.labelMr;
  return item.labelEn;
}
