import { describe, it, expect } from 'vitest';
import { ApiKeySchema, CreateApiKeyInputSchema } from '../api-key.js';

const valid = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  userId: 'firebase-uid-123',
  keyHash: 'a'.repeat(64),
  keyPrefix: 'mf_a1B2c3D4',
  label: 'CI key',
  createdAt: '2026-05-11T10:00:00.000Z',
};

describe('ApiKeySchema', () => {
  it('parses a valid key', () => {
    const result = ApiKeySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('parses with optional fields', () => {
    const result = ApiKeySchema.safeParse({
      ...valid,
      lastUsedAt: '2026-05-11T12:00:00.000Z',
      revokedAt: '2026-05-11T14:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { label: _, ...noLabel } = valid;
    expect(ApiKeySchema.safeParse(noLabel).success).toBe(false);
  });

  it('rejects empty label', () => {
    expect(ApiKeySchema.safeParse({ ...valid, label: '' }).success).toBe(false);
  });

  it('rejects label over 128 chars', () => {
    expect(ApiKeySchema.safeParse({ ...valid, label: 'x'.repeat(129) }).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(ApiKeySchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it('rejects invalid UUID for id', () => {
    expect(ApiKeySchema.safeParse({ ...valid, id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('CreateApiKeyInputSchema', () => {
  it('parses valid input', () => {
    expect(CreateApiKeyInputSchema.safeParse({ label: 'My key' }).success).toBe(true);
  });

  it('rejects empty label', () => {
    expect(CreateApiKeyInputSchema.safeParse({ label: '' }).success).toBe(false);
  });
});
