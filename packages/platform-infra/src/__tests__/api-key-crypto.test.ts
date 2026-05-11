import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey } from '../crypto/api-key-crypto.js';

describe('generateApiKey', () => {
  it('returns plaintext with mf_ prefix', () => {
    const { plaintext } = generateApiKey();
    expect(plaintext.startsWith('mf_')).toBe(true);
  });

  it('returns plaintext of at least 40 characters', () => {
    const { plaintext } = generateApiKey();
    expect(plaintext.length).toBeGreaterThanOrEqual(40);
  });

  it('returns a keyPrefix that is first 11 chars of plaintext', () => {
    const { plaintext, keyPrefix } = generateApiKey();
    expect(keyPrefix).toBe(plaintext.slice(0, 11));
  });

  it('returns a keyHash that matches hashApiKey(plaintext)', () => {
    const { plaintext, keyHash } = generateApiKey();
    expect(keyHash).toBe(hashApiKey(plaintext));
  });

  it('generates unique keys on each call', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe('hashApiKey', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashApiKey('mf_test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = hashApiKey('mf_abc');
    const b = hashApiKey('mf_abc');
    expect(a).toBe(b);
  });
});
