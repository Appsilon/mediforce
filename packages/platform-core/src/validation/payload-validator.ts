import type { TriggerInputField } from '../schemas/workflow-definition';

export interface PayloadValidationError {
  field: string;
  message: string;
}

export interface PayloadValidationResult {
  valid: boolean;
  errors: PayloadValidationError[];
  /** The payload the firing should actually carry: what the caller supplied
   *  plus the declared `default` of every field they left out. Callers fire
   *  with this, never with their own input — a `default` belongs to the
   *  contract, so a webhook, cron row or spawn that omits the field must land
   *  on the same value the Start Run form prefills. */
  payload: Record<string, unknown>;
}

export function validatePayload(
  rawPayload: Record<string, unknown>,
  triggerInput: TriggerInputField[],
): PayloadValidationResult {
  const errors: PayloadValidationError[] = [];
  const declaredNames = new Set(triggerInput.map((f) => f.name));
  const payload = applyDefaults(rawPayload, triggerInput);

  for (const key of Object.keys(payload)) {
    if (!declaredNames.has(key)) {
      errors.push({ field: key, message: `unknown field '${key}' not declared in triggerInput` });
    }
  }

  for (const field of triggerInput) {
    const value = payload[field.name];
    const type = field.type ?? 'string';

    if (value === undefined || value === null) {
      if (field.required) {
        errors.push({ field: field.name, message: `required field '${field.name}' is missing` });
      }
      continue;
    }

    if (field.required && type === 'multiselect' && Array.isArray(value) && value.length === 0) {
      errors.push({ field: field.name, message: `required field '${field.name}' must have at least one selection` });
      continue;
    }

    const typeError = validateFieldType(field.name, value, type, field.options);
    if (typeError) {
      errors.push(typeError);
    }
  }

  return { valid: errors.length === 0, errors, payload };
}

/** Fill in the `default` of every declared field the caller left out. `null` is
 *  absent, the same way the required check reads it, so a caller clearing
 *  a field gets the default rather than a hole. A supplied `false` / `0` / `''`
 *  is a value and survives. The result is validated like any other payload, so
 *  a default that violates its own declared type fails loudly at fire time. */
function applyDefaults(
  payload: Record<string, unknown>,
  triggerInput: TriggerInputField[],
): Record<string, unknown> {
  const resolved = { ...payload };

  for (const field of triggerInput) {
    const value = resolved[field.name];
    if ((value === undefined || value === null) && field.default !== undefined) {
      resolved[field.name] = field.default;
    }
  }

  return resolved;
}

function validateFieldType(
  name: string,
  value: unknown,
  type: string,
  options?: string[],
): PayloadValidationError | null {
  switch (type) {
    case 'string':
    case 'textarea':
      if (typeof value !== 'string') {
        return { field: name, message: `'${name}' must be a string` };
      }
      return null;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return { field: name, message: `'${name}' must be a number` };
      }
      return null;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return { field: name, message: `'${name}' must be a boolean` };
      }
      return null;

    case 'date':
    case 'datetime':
      if (typeof value !== 'string') {
        return { field: name, message: `'${name}' must be a ${type} string` };
      }
      if (isNaN(Date.parse(value))) {
        return { field: name, message: `'${name}' is not a valid ${type}` };
      }
      return null;

    case 'select':
      if (typeof value !== 'string') {
        return { field: name, message: `'${name}' must be a string` };
      }
      if (options && !options.includes(value)) {
        return { field: name, message: `'${name}' must be one of: ${options.join(', ')}` };
      }
      return null;

    case 'multiselect':
      if (!Array.isArray(value)) {
        return { field: name, message: `'${name}' must be an array` };
      }
      if (options) {
        const invalid = value.filter((item) => typeof item !== 'string' || !options.includes(item));
        if (invalid.length > 0) {
          return { field: name, message: `'${name}' contains invalid options: ${invalid.map(String).join(', ')}; allowed: ${options.join(', ')}` };
        }
      }
      return null;

    case 'object':
      // Opaque by design (ADR-0012): the Definition declares "a JSON object
      // lands here" and nothing about its contents. Arrays are rejected so
      // `${triggerPayload.<name>.<key>}` always has something to walk; an
      // opaque array nests under an object field instead.
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { field: name, message: `'${name}' must be a JSON object` };
      }
      return null;

    default:
      return null;
  }
}
