import { interpolate } from '../interpolation.js';
import type { ReshapeActionHandler } from '../types.js';

/**
 * reshape action: pure data transformation. Walks `config.values` with the
 * shared interpolation utility (dot/bracket path access, multi-placeholder
 * concat, sole-placeholder returns raw value) and returns the resulting
 * object as the step's output.
 *
 * No side effects — equivalent to n8n's Set / Edit Fields node. Use to
 * adapt the shape between two upstream/downstream actions without a script
 * step.
 */
export const reshapeActionHandler: ReshapeActionHandler = async (config, ctx) => {
  const result = interpolate(config.values, ctx.sources);
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(
      `reshape action expected an object output but got ${Array.isArray(result) ? 'array' : typeof result}`,
    );
  }
  return result as Record<string, unknown>;
};

export type { ReshapeActionHandler };
