import type { ZodType, z } from 'zod';

/**
 * Strip keys whose value is `undefined`, leaving `null` and every other value
 * intact.
 *
 * `null` is the storage representation (a nullable column), `undefined`/absent
 * is the domain representation (a Zod `.optional()` field). Row mappers can
 * therefore build the full object with `column ?? undefined` for optionals and
 * convert once at the boundary, instead of per-field conditional spreads.
 */
export function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, value]) => value !== undefined),
  ) as T;
}

/**
 * Parse a raw storage row into its domain shape: drop `undefined` keys, then
 * validate against the schema. Folds the strip + `schema.parse()` that every
 * repository read boundary repeats into a single call.
 */
export function parseRow<S extends ZodType>(
  schema: S,
  raw: Record<string, unknown>,
): z.infer<S> {
  return schema.parse(compact(raw));
}
