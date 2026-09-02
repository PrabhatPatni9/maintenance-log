import type { Lang } from '@shared/types';

const LOCALE: Record<Lang, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN',
};

/**
 * "4 June 2026" — a localised month name (Hindi/Marathi get their own word
 * for June) but the day and year stay Latin digits in every language.
 * CLAUDE.md section 10: machine numbers and dates are read off physical
 * objects in Latin digits; rendering ४ जून २०२६ would be a bug, not
 * localisation, the same way a machine numbered 12 must never show as १२.
 */
export function formatDayHeading(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    numberingSystem: 'latn',
  }).format(new Date(ts));
}

/** "9:52 AM" — clock time only, Latin digits, used inside a day group where
 * the date itself is already the group's heading. */
export function formatClockTime(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    hour: 'numeric',
    minute: '2-digit',
    numberingSystem: 'latn',
  }).format(new Date(ts));
}

/** Calendar-day grouping key in the viewer's local timezone — two logs on
 * the same day.toDateString() belong under the same heading regardless of
 * what time within that day each one landed. */
export function dayKey(ts: number): string {
  return new Date(ts).toDateString();
}
