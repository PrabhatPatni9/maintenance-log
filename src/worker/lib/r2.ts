import type { Env } from './env';
import { hmacSha256Hex } from '@shared/crypto';

/** CLAUDE.md section 12. Human readable keys matter when someone is digging
 * through the bucket at 11pm. */
export function audioKey(
  shedCode: string,
  machineNo: string,
  logId: string,
  seq: number,
): string {
  return `audio/${shedCode}/${machineNo}/${logId}/${seq}.webm`;
}

const UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * "Presigned PUT" without S3-style R2 credentials.
 *
 * Native R2 presigned URLs need a separate R2 API access key/secret pair,
 * which is not one of the secrets CLAUDE.md/AGENTS.md provisions for this
 * project. Instead this signs a short-lived HMAC token over the exact
 * object key using JWT_SECRET (already a Worker secret), and the client PUTs
 * straight to a Worker route that streams the body into R2 via the binding.
 * From the client's point of view this is the same shape: fetch a URL, then
 * one PUT with the audio bytes, no JSON body round trip through the Worker.
 */
export async function signUploadToken(env: Env, key: string): Promise<string> {
  const exp = Date.now() + UPLOAD_TOKEN_TTL_MS;
  const sig = await hmacSha256Hex(env.JWT_SECRET, `${key}:${exp}`);
  return `${exp}.${sig}`;
}

export async function verifyUploadToken(
  env: Env,
  key: string,
  token: string,
): Promise<boolean> {
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await hmacSha256Hex(env.JWT_SECRET, `${key}:${exp}`);
  return expected === sig;
}
