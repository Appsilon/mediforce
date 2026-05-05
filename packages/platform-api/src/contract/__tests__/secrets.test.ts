import { describe, it, expect } from 'vitest';
import {
  SetSecretInputSchema,
  ListSecretKeysInputSchema,
  ListSecretKeysOutputSchema,
  DeleteSecretInputSchema,
  SetSecretOutputSchema,
  DeleteSecretOutputSchema,
  SECRET_VALUE_MAX_BYTES,
} from '../secrets.js';

describe('SetSecretInputSchema', () => {
  it('accepts valid input', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: 'my-ns',
      workflow: 'my-wf',
      key: 'API_KEY',
      value: 'sk-abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty namespace', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: '',
      workflow: 'wf',
      key: 'K',
      value: 'V',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty key', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
      key: '',
      value: 'V',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty value', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
      key: 'K',
      value: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects key longer than 256 chars', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
      key: 'X'.repeat(257),
      value: 'V',
    });
    expect(result.success).toBe(false);
  });

  it('rejects value exceeding max bytes', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
      key: 'K',
      value: 'X'.repeat(SECRET_VALUE_MAX_BYTES + 1),
    });
    expect(result.success).toBe(false);
  });

  it('accepts value at exactly max bytes', () => {
    const result = SetSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
      key: 'K',
      value: 'X'.repeat(SECRET_VALUE_MAX_BYTES),
    });
    expect(result.success).toBe(true);
  });
});

describe('ListSecretKeysInputSchema', () => {
  it('accepts valid input', () => {
    const result = ListSecretKeysInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing workflow', () => {
    const result = ListSecretKeysInputSchema.safeParse({ namespace: 'ns' });
    expect(result.success).toBe(false);
  });
});

describe('ListSecretKeysOutputSchema', () => {
  it('accepts empty keys array', () => {
    const result = ListSecretKeysOutputSchema.safeParse({ keys: [] });
    expect(result.success).toBe(true);
  });

  it('accepts populated keys array', () => {
    const result = ListSecretKeysOutputSchema.safeParse({ keys: ['A', 'B', 'C'] });
    expect(result.success).toBe(true);
  });
});

describe('DeleteSecretInputSchema', () => {
  it('accepts valid input', () => {
    const result = DeleteSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
      key: 'SECRET_KEY',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing key', () => {
    const result = DeleteSecretInputSchema.safeParse({
      namespace: 'ns',
      workflow: 'wf',
    });
    expect(result.success).toBe(false);
  });
});

describe('SetSecretOutputSchema', () => {
  it('accepts { ok: true }', () => {
    expect(SetSecretOutputSchema.safeParse({ ok: true }).success).toBe(true);
  });

  it('rejects { ok: false }', () => {
    expect(SetSecretOutputSchema.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('DeleteSecretOutputSchema', () => {
  it('accepts { ok: true }', () => {
    expect(DeleteSecretOutputSchema.safeParse({ ok: true }).success).toBe(true);
  });
});
