import { SignJWT, jwtVerify } from 'jose';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppEnv, Env, SessionRecord } from './env';
import { sha256Hex, hmacSha256Hex } from '@shared/crypto';
import { mapUser } from './mappers';

export type { SessionRecord };

const COOKIE_NAME = 'sid';
const SESSION_SECONDS = 90 * 24 * 60 * 60;

/**
 * Unknown-phone salts must still look like real ones, or the endpoint
 * becomes a way to enumerate registered phone numbers. Derive a stable
 * pseudo-salt from the phone plus the server secret instead of a fixed
 * string, so it is deterministic per phone but not guessable.
 */
export async function fakeSaltFor(env: Env, phone: string): Promise<string> {
  const hex = await hmacSha256Hex(env.JWT_SECRET, `fake-salt:${phone}`);
  return btoa(hex.slice(0, 32));
}

export async function hashDerivedKey(derivedKeyB64: string): Promise<string> {
  return sha256Hex(derivedKeyB64);
}

function secretKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function createSession(
  c: Context<AppEnv>,
  session: SessionRecord,
): Promise<void> {
  const sid = crypto.randomUUID();
  await c.env.SESSIONS.put(`session:${sid}`, JSON.stringify(session), {
    expirationTtl: SESSION_SECONDS,
  });

  const jwt = await new SignJWT({ sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secretKey(c.env));

  setCookie(c, COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

/**
 * The session record cached in KV (SessionRecord: phone, name, role, lang)
 * is what GET /api/me and every route's `c.get('session')` read — never the
 * DB directly. A name change has to land here too, or the operator's own
 * greeting, header, and every place that reads their session name stays
 * stale for up to 90 days (the session TTL) until they happen to log out
 * and back in, which reads as "did that even save?" Re-reads the cookie's
 * own `sid` rather than needing the caller to have one lying around.
 */
export async function updateSessionCache(
  c: Context<AppEnv>,
  patch: Partial<SessionRecord>,
): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return;
  let sid: string;
  try {
    const { payload } = await jwtVerify(token, secretKey(c.env));
    sid = payload.sid as string;
  } catch {
    return;
  }
  const raw = await c.env.SESSIONS.get(`session:${sid}`);
  if (!raw) return;
  const current = JSON.parse(raw) as SessionRecord;
  await c.env.SESSIONS.put(`session:${sid}`, JSON.stringify({ ...current, ...patch }), {
    expirationTtl: SESSION_SECONDS,
  });
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretKey(c.env));
      const sid = payload.sid as string;
      await c.env.SESSIONS.delete(`session:${sid}`);
    } catch {
      /* token already invalid, nothing to revoke */
    }
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

/** Resolves the caller's session, or null if there is none / it was revoked. */
export async function resolveSession(
  c: Context<AppEnv>,
): Promise<SessionRecord | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;

  let sid: string;
  try {
    const { payload } = await jwtVerify(token, secretKey(c.env));
    sid = payload.sid as string;
  } catch {
    return null;
  }

  const raw = await c.env.SESSIONS.get(`session:${sid}`);
  if (!raw) return null; // revoked, or expired out of KV
  const session = JSON.parse(raw) as SessionRecord;

  // Self-heal a session cached before `isOperator`/`isUtility` existed
  // (migration 0006). Sessions last 90 days and nothing else ever rewrites
  // one wholesale, so without this every already-logged-in account reads
  // both flags as `undefined` the moment this shipped — falsy, which hides
  // every flow on Home (CLAUDE.md's session design already accepts that a
  // role change takes effect on next login; a field that never existed
  // before is a different problem and shouldn't need a logout to fix).
  // Re-derives from the DB once and rewrites the cache, so this only ever
  // costs one extra read per stale session, not per request.
  if (typeof session.isOperator !== 'boolean' || typeof session.isUtility !== 'boolean') {
    const row = await c.env.DB.prepare('SELECT * FROM users WHERE phone = ? AND active = 1')
      .bind(session.phone)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const user = mapUser(row);
    const healed: SessionRecord = {
      phone: user.phone,
      name: user.name,
      role: user.role,
      isOperator: user.isOperator,
      isUtility: user.isUtility,
      lang: user.lang,
    };
    await c.env.SESSIONS.put(`session:${sid}`, JSON.stringify(healed), { expirationTtl: SESSION_SECONDS });
    return healed;
  }

  return session;
}
