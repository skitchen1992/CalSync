import { createHash } from 'node:crypto';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/**
 * A valid Google Calendar event id derived from `seed`: base32hex (0-9, a-v) of its SHA-256,
 * 52 characters. The same seed always yields the same id, which makes inserts repeatable: a
 * retried insert answers 409 instead of creating a duplicate.
 */
export function toGoogleEventId(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  let bits = 0;
  let value = 0;
  let id = '';
  for (const byte of digest) {
    // At most 4 unread bits remain between bytes, so 12 bits of state are enough.
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      id += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    id += BASE32HEX[(value << (5 - bits)) & 31];
  }
  return id;
}
