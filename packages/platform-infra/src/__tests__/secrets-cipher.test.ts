import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSecretsKey, encrypt, decrypt } from '../crypto/secrets-cipher.js';

const VALID_KEY = 'a'.repeat(64);

describe('validateSecretsKey', () => {
  const original = process.env.SECRETS_ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SECRETS_ENCRYPTION_KEY;
    } else {
      process.env.SECRETS_ENCRYPTION_KEY = original;
    }
  });

  it('passes for a valid 64-hex-char key', () => {
    process.env.SECRETS_ENCRYPTION_KEY = VALID_KEY;
    expect(() => validateSecretsKey()).not.toThrow();
  });

  it('throws when key is missing, mentioning .env.example and bootstrap-server.py', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    expect(() => validateSecretsKey()).toThrow(/SECRETS_ENCRYPTION_KEY/);
    expect(() => validateSecretsKey()).toThrow(/\.env\.example/);
    expect(() => validateSecretsKey()).toThrow(/bootstrap-server\.py/);
  });

  it('throws for a key that is too short', () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'abc123';
    expect(() => validateSecretsKey()).toThrow(/64/);
  });

  it('throws for a key that is too long', () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'a'.repeat(65);
    expect(() => validateSecretsKey()).toThrow(/64/);
  });

  it('throws for a key with non-hex characters', () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'z'.repeat(64);
    expect(() => validateSecretsKey()).toThrow(/64/);
  });
});

describe('encrypt / decrypt round-trip', () => {
  beforeEach(() => {
    process.env.SECRETS_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  });

  it('round-trips plaintext through encrypt and decrypt', () => {
    const plaintext = 'super-secret-value';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });
});
