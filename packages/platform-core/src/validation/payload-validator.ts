import type { TriggerInputField } from '../schemas/workflow-definition.js';

export interface PayloadValidationError {
  field: string;
  message: string;
}

export interface PayloadValidationResult {
  valid: boolean;
  errors: PayloadValidationError[];
}

export function validatePayload(
  payload: Record<string, unknown>,
  triggerInput: TriggerInputField[],
): PayloadValidationResult {
  const errors: PayloadValidationError[] = [];
  const declaredNames = new Set(triggerInput.map((f) => f.name));

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

    const typeError = validateFieldType(field.name, value, type, field.options);
    if (typeError) {
      errors.push(typeError);
    }
  }

  return { valid: errors.length === 0, errors };
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
      if (typeof value !== 'number') {
        return { field: name, message: `'${name}' must be a number` };
      }
      return null;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return { field: name, message: `'${name}' must be a boolean` };
      }
      return null;

    case 'date':
      if (typeof value !== 'string') {
        return { field: name, message: `'${name}' must be a date string` };
      }
      if (isNaN(Date.parse(value))) {
        return { field: name, message: `'${name}' is not a valid date` };
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

    default:
      return null;
  }
}
