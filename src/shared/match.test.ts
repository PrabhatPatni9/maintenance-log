import { describe, expect, it } from 'vitest';
import { compile, match, normalise, type TaxonomyItem } from './match';

const taxonomy: TaxonomyItem[] = [
  { code: 'OIL_CHANGE', kind: 'action', synonyms: ['oil change', 'तेल बदलले', 'तेल बदला'] },
  { code: 'AIR_LEAKAGE', kind: 'action', synonyms: ['air leakage', 'leakage', 'हवा गळती'] },
  { code: 'GREASING', kind: 'action', synonyms: ['greasing', 'grease'] },
];

describe('normalise', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalise('  Oil Change,  done!  ')).toBe('oil change done');
  });

  it('leaves Devanagari untouched aside from whitespace/punctuation', () => {
    expect(normalise('तेल बदलले.')).toBe('तेल बदलले');
  });
});

describe('match', () => {
  const compiled = compile(taxonomy);

  it('matches an English transcript', () => {
    const result = match('12 number machine oil change and air compressor leakage tha', compiled);
    expect(result.map((r) => r.code).sort()).toEqual(['AIR_LEAKAGE', 'OIL_CHANGE']);
  });

  it('matches the same meaning in Marathi Devanagari, per CLAUDE.md section 8', () => {
    const result = match('बारा नंबर मशीनला oil change केला आणि air compressor मध्ये leakage होता', compiled);
    expect(result.map((r) => r.code).sort()).toEqual(['AIR_LEAKAGE', 'OIL_CHANGE']);
  });

  it('does not match a substring that is not a whole word', () => {
    // "grease" should not fire inside an unrelated longer word
    const result = match('greasepaint is not greasing', compiled);
    expect(result.map((r) => r.code)).toEqual(['GREASING']);
  });

  it('matches an item at most once per transcript', () => {
    const result = match('oil change oil change oil change', compiled);
    expect(result.filter((r) => r.code === 'OIL_CHANGE')).toHaveLength(1);
  });

  it('returns nothing for an unrelated transcript', () => {
    expect(match('machine ran fine all shift', compiled)).toEqual([]);
  });
});
