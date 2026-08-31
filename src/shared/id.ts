/**
 * UUIDv7: time-ordered, generated client side so the server can accept the
 * client's id as the primary key (CLAUDE.md section 7 — this is what makes
 * upload retries idempotent for free). No dependency pulled in for this; the
 * algorithm is ~20 lines.
 */
export function uuidv7(): string {
  const unixMs = Date.now();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit big-endian timestamp in bytes 0-5
  bytes[0] = (unixMs / 2 ** 40) & 0xff;
  bytes[1] = (unixMs / 2 ** 32) & 0xff;
  bytes[2] = (unixMs / 2 ** 24) & 0xff;
  bytes[3] = (unixMs / 2 ** 16) & 0xff;
  bytes[4] = (unixMs / 2 ** 8) & 0xff;
  bytes[5] = unixMs & 0xff;

  // Version 7 in the high nibble of byte 6
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  // Variant 10 in the high bits of byte 8
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
