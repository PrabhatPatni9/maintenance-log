// Mirrors src/worker/lib/date.ts's todayInTz: the app is Ratanmoti-only, one
// shed, one timezone (CLAUDE.md — not multi-tenant), so a hardcoded zone here
// stays correct without threading server config to the client. Needed so a
// reading submitted near midnight lands on the same calendar day the client
// shows it prefilled under as the server (which computes "today" itself,
// never trusting a client-picked date) will actually record it under.
const APP_TZ = 'Asia/Kolkata';

export function todayInAppTz(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}
