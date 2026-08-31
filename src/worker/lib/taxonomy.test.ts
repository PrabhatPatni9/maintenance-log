import { describe, expect, it } from 'vitest';
import { parseSynonyms } from './taxonomy';

describe('parseSynonyms', () => {
  it('splits on commas, trims, and lowercases', () => {
    expect(parseSynonyms(' Oil Change , OIL CHNGE ,oil daala')).toEqual([
      { phrase: 'oil change', script: 'latn' },
      { phrase: 'oil chnge', script: 'latn' },
      { phrase: 'oil daala', script: 'latn' },
    ]);
  });

  it('tags Devanagari phrases separately from Latin ones in the same field', () => {
    expect(parseSynonyms('oil change, तेल बदलले, ऑइल चेंज')).toEqual([
      { phrase: 'oil change', script: 'latn' },
      { phrase: 'तेल बदलले', script: 'deva' },
      { phrase: 'ऑइल चेंज', script: 'deva' },
    ]);
  });

  it('drops empty entries from trailing commas', () => {
    expect(parseSynonyms('oil change,, ,')).toEqual([{ phrase: 'oil change', script: 'latn' }]);
  });
});
