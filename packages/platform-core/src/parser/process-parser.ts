import { parse as parseYaml } from 'yaml';
import { ProcessDefinitionSchema } from '../schemas/process-definition.js';
import type { ProcessDefinition } from '../schemas/process-definition.js';
import { formatZodErrors } from './error-formatter.js';

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Parses a YAML string into a validated ProcessDefinition.
 *
 * Pipeline:
 * 1. Input validation (non-empty string)
 * 2. YAML syntax parsing (yaml library)
 * 3. Schema validation (Zod ProcessDefinitionSchema)
 *
 * Returns either a typed ProcessDefinition or a human-readable error message.
 * YAML syntax errors include line/column information from the yaml library.
 * Schema validation errors include field paths (e.g., "steps.0.type").
 */
export function parseProcessDefinition(
  yamlString: unknown,
): ParseResult<ProcessDefinition> {
  // Step 0: Input validation
  if (typeof yamlString !== 'string' || yamlString.trim() === '') {
    return { success: false as const, error: 'Input must be a non-empty string' };
  }

  // Step 1: YAML syntax parsing
  let raw: unknown;
  try {
    raw = parseYaml(yamlString);
  } catch (err) {
    return {
      success: false as const,
      error: `YAML syntax error: ${(err as Error).message}`,
    };
  }

  // YAML-only-comments or empty documents parse to null
  if (raw == null) {
    return {
      success: false as const,
      error: 'YAML document is empty or contains only comments',
    };
  }

  // Step 2: Schema validation
  const result = ProcessDefinitionSchema.safeParse(raw);
  if (!result.success) {
    return {
      success: false as const,
      error: formatZodErrors(result.error),
    };
  }

  // Step 3: Success
  return { success: true as const, data: result.data };
}
