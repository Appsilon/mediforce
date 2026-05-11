import { createHash, randomBytes } from 'crypto';

const KEY_PREFIX = 'mf_';
const RAW_BYTES = 32;

export function generateApiKey(): { plaintext: string; keyHash: string; keyPrefix: string } {
  const raw = randomBytes(RAW_BYTES);
  const plaintext = KEY_PREFIX + raw.toString('base64url');
  const keyHash = hashApiKey(plaintext);
  const keyPrefix = plaintext.slice(0, 11);
  return { plaintext, keyHash, keyPrefix };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
