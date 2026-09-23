import type { OutputSchemaShape } from '@mediforce/platform-core';

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
    const value = data[key];
    const expectedType = spec.type;
    if (!expectedType) continue;

    if (expectedType === 'array' && !Array.isArray(value)) {
      return `property "${key}" expected array, got ${typeof value}`;
    }
    if (expectedType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      return `property "${key}" expected object, got ${Array.isArray(value) ? 'array' : typeof value}`;
    }
    if (expectedType === 'string' && typeof value !== 'string') {
      return `property "${key}" expected string, got ${typeof value}`;
    }
    if (expectedType === 'number' && typeof value !== 'number') {
      return `property "${key}" expected number, got ${typeof value}`;
    }
  }

  return null;
}
