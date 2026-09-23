import {
  OutputSchemaPropertyTypeSchema,
  type OutputSchemaPropertyType,
  type OutputSchemaShape,
} from '@mediforce/platform-core';

const TYPE_CHECKS: Record<OutputSchemaPropertyType, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && Array.isArray(value) === false,
};

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Checks an output against the structural JSON Schema subset shared by cowork
 *  artifacts and `agent.outputSchema`. Returns the first violation, or `null`. */
export function validateOutputSchema(
  output: Record<string, unknown>,
  schema: OutputSchemaShape,
): string | null {
  let data = output;

  if ('raw' in output && typeof output.raw === 'string' && Object.keys(output).length === 1) {
    try {
      const parsed = JSON.parse(output.raw);
      if (Array.isArray(parsed)) return 'expected object, got array';
      if (typeof parsed !== 'object' || parsed === null) return 'output is not valid JSON';
      data = parsed as Record<string, unknown>;
    } catch {
      return 'output is not valid JSON';
    }
  }

  if (Object.keys(data).length === 0
    || (Object.keys(data).length === 1 && 'raw' in data && (data.raw === '' || data.raw == null))) {
    return 'output is empty';
  }

  const required = schema.required ?? [];
  const missing = required.filter((key) => !(key in data));
  if (missing.length > 0) return `missing required keys: ${missing.join(', ')}`;

  const properties = schema.properties ?? {};
  for (const [key, spec] of Object.entries(properties)) {
    if (!(key in data)) continue;
    // Cowork's looser schema can name a type outside the subset; it goes unchecked.
    const expectedType = OutputSchemaPropertyTypeSchema.safeParse(spec.type);
    if (expectedType.success === false) continue;

    const value = data[key];
    if (TYPE_CHECKS[expectedType.data](value) === false) {
      return `property "${key}" expected ${expectedType.data}, got ${jsonTypeOf(value)}`;
    }
  }

  return null;
}
