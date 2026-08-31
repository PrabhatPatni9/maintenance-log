/**
 * Transcript to taxonomy matcher.
 *
 * Shared by the browser and the Worker so a log looks identical whichever path
 * it took. Import this from both sides. Do not write a second copy.
 *
 * Deliberately simple: normalise, then test one regex per taxonomy item.
 * No transliteration engine, no fuzzy library, no model.
 *
 * The reason plain regex is sufficient lives in the DATA, not the code. Every
 * synonym list carries both scripts, because Web Speech returns Devanagari for
 * hi-IN and mr-IN but Latin for en-IN. The same operator saying the same thing
 * produces `तेल बदलले` on one setting and `oil change` on another, so both are
 * in OIL_CHANGE's synonym list.
 *
 * When a match is missed in the shed, the fix is adding a synonym in the admin
 * screen. It is never a code change and never needs a deploy.
 */

export interface TaxonomyItem {
  code: string;
  kind: 'action' | 'part';
  synonyms: string[];
}

export interface Match {
  code: string;
  kind: 'action' | 'part';
  /** The synonym that fired. Kept for the match-quality report in phase 6. */
  matched: string;
}

/**
 * Lowercase, collapse whitespace, strip punctuation. Nothing else.
 *
 * Devanagari has no case so toLowerCase is a no-op there, which is fine: it
 * lets one code path handle all three languages.
 *
 * The punctuation class keeps Devanagari combining marks (U+0900-U+097F) intact.
 * Stripping those would destroy the words we are trying to match.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devanagari has no \b word boundary in JavaScript's regex engine, because the
 * \w class is ASCII-only. So boundaries are asserted manually against
 * whitespace or string edges, which works for both scripts.
 */
function buildPattern(synonym: string): RegExp {
  const escaped = normalise(synonym).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');
}

/** Compile once per taxonomy load, not once per transcript. */
export function compile(items: TaxonomyItem[]) {
  return items.map((item) => ({
    code: item.code,
    kind: item.kind,
    patterns: item.synonyms.map((s) => ({ raw: s, re: buildPattern(s) })),
  }));
}

export type CompiledTaxonomy = ReturnType<typeof compile>;

/**
 * One item matches at most once per log. Order does not matter: every item is
 * tested independently, so a longer synonym never shadows a shorter one in a
 * different item.
 */
export function match(
  transcript: string,
  taxonomy: CompiledTaxonomy,
): Match[] {
  const haystack = ` ${normalise(transcript)} `;
  const out: Match[] = [];

  for (const item of taxonomy) {
    for (const p of item.patterns) {
      if (p.re.test(haystack)) {
        out.push({ code: item.code, kind: item.kind, matched: p.raw });
        break; // first synonym wins, one match per item
      }
    }
  }

  return out;
}
