import type { Env } from './env';

/** 'YYYY-MM-DD' for right now, in the shed's local timezone — a Worker runs
 * in UTC, so a reading taken late in the evening IST must not land on
 * tomorrow's UTC date. Meter readings are one-per-calendar-day, and that
 * day has to be the operator's day, not the server's. */
export function todayInTz(env: Env): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.APP_TIMEZONE || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // en-CA formats as YYYY-MM-DD
}
