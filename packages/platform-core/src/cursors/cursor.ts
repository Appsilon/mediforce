import type { ZodType } from 'zod';

/**
 * Generic opaque cursor codec for repository pagination.
 *
 * Encoding: `base64url(JSON.stringify(payload))`. Per-domain modules wrap
 * this with a Zod schema describing the payload shape — keyset tuple,
 * snapshot offset, etc. — so the cursor stays self-describing and
 * additive new fields don't break old tokens (a missing field decodes
 * via the schema's `.optional()` rather than splitting on a separator).
 *
 * The encoded value is treated as opaque on the wire; clients pass it
 * back verbatim from `nextCursor` into the next request's `cursor`.
 */
export function encodeCursor<T>(payload: T): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode + validate a cursor token. Returns `null` for any malformed
 * input (non-base64url, non-JSON, or shape mismatch). Repositories must
 * fall back to "no cursor" (page 1) on `null` rather than throwing —
 * the same robustness rule as `getById` returning `null` on missing.
 */
export function decodeCursor<T>(cursor: string, schema: ZodType<T>): T | null {
  if (cursor === '') return null;
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
