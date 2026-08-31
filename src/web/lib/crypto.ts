/**
 * Client side password derivation.
 *
 * Workers on the free plan allow 10ms CPU per request. A server side PBKDF2
 * at a sensible iteration count blows through that, so the browser does the
 * expensive work instead: PBKDF2-SHA256 at 150k iterations, over the
 * password, with a per-user salt fetched by phone number. Only the derived
 * key crosses the network; the server hashes it once with SHA-256 and
 * compares against `pass_hash`. It never sees the password itself.
 *
 * This makes the derived key password-equivalent in transit, which relies on
 * TLS. For an internal tool on a company subdomain that trade is accepted
 * (CLAUDE.md section 9) — do not "fix" this by moving derivation server side.
 */

const ITERATIONS = 150_000;

export function generateSaltB64(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function deriveKeyB64(password: string, saltB64: string): Promise<string> {
  const saltBytes = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  let bin = '';
  for (const b of new Uint8Array(bits)) bin += String.fromCharCode(b);
  return btoa(bin);
}
