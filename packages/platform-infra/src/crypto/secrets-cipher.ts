import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Validate SECRETS_ENCRYPTION_KEY at startup. Throws with a clear message pointing
 * to .env.example and bootstrap-server.py if the key is missing or malformed.
 * Call this once during service initialisation so the process fails fast.
 */
export function validateSecretsKey(): void {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY is not set. ' +
        'Set it to a 64-character hex string in your .env file (see .env.example). ' +
        'For a fresh install, run scripts/bootstrap-server.py to generate a key.',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ` +
        `Got ${raw.length} character(s). ` +
        'See .env.example or run scripts/bootstrap-server.py to generate a valid key.',
    );
  }
}

function getKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY env var is not set. Required for workflow secrets encryption.',
    );
  }
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Got ${raw.length} chars.`,
    );
  }
  return buf;
}

/** Encrypt a plaintext string. Returns "iv:ciphertext:authTag" in hex. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}

/** Decrypt a string produced by encrypt(). */
export function decrypt(encoded: string): string {
  const key = getKey();
  const [ivHex, ciphertextHex, authTagHex] = encoded.split(':');
  if (!ivHex || !ciphertextHex || !authTagHex) {
    throw new Error('Invalid encrypted value format — expected "iv:ciphertext:authTag"');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
