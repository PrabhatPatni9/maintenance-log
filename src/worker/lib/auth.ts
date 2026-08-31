import { SignJWT, jwtVerify } from 'jose';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppEnv, Env, SessionRecord } from './env';
import { sha256Hex, hmacSha256Hex } from '@shared/crypto';

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
  return JSON.parse(raw) as SessionRecord;
}
