import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { encodeCursor, decodeCursor } from '../cursor.js';

const TestPayloadSchema = z.object({
  a: z.string().min(1),
  b: z.number().int().nonnegative(),
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips an arbitrary payload through base64url JSON', () => {
    const token = encodeCursor({ a: 'hello', b: 42 });
    expect(decodeCursor(token, TestPayloadSchema)).toEqual({ a: 'hello', b: 42 });
  });

  it('returns null for the empty string', () => {
    expect(decodeCursor('', TestPayloadSchema)).toBeNull();
  });

  it('returns null for non-JSON payloads (e.g. legacy `|`-separated tokens)', () => {
    // base64url of the literal "ts|id" — round-trips through base64 but
    // JSON.parse throws, so the codec must surface null rather than crash.
    const legacy = Buffer.from('2026-05-28T10:00:00.000Z|ar-1', 'utf8').toString('base64url');
    expect(decodeCursor(legacy, TestPayloadSchema)).toBeNull();
  });

  it('returns null when the payload fails schema validation', () => {
    const token = encodeCursor({ a: '', b: -1 });
    expect(decodeCursor(token, TestPayloadSchema)).toBeNull();
  });

  it('returns null when extra-permissive JSON does not match the schema shape', () => {
    const token = encodeCursor({ unrelated: 'field' });
    expect(decodeCursor(token, TestPayloadSchema)).toBeNull();
  });
});
