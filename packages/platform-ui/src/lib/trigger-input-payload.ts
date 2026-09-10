import { isJsonObject, type TriggerInputField } from '@mediforce/platform-core';

/**
 * A trigger-input field of type `object` carries an opaque JSON body (ADR-0012).
 * The form holds it as text, so the client applies the server's own acceptance
 * rule — `isJsonObject` from `platform-core`, the predicate `payload-validator`'s
 * `case 'object'` uses — to text it first has to parse.
 */
export function parseJsonObjectText(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse a cron trigger's static payload editor text into the payload to send.
 * Empty text means "no payload", so it parses to `{}`; anything that isn't a
 * JSON object is `null` so the caller can block submit rather than post
 * something the server will only reject.
 */
export function parseCronPayloadText(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) return {};
  return parseJsonObjectText(text);
}

/** True while any `object` field holds non-empty text that would be rejected. */
export function hasInvalidObjectInput(
  fields: TriggerInputField[],
  values: Record<string, unknown>,
): boolean {
  return fields.some((field) => {
    if (field.type !== 'object') return false;
    const value = values[field.name];
    if (value === undefined || isJsonObject(value)) return false;
    const text = String(value).trim();
    return text !== '' && parseJsonObjectText(text) === null;
  });
}

export function buildTriggerPayload(
  fields: TriggerInputField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (raw === '' || raw === undefined) continue;
    if (Array.isArray(raw) && raw.length === 0) continue;

    if (field.type === 'number') {
      const num = parseFloat(String(raw));
      if (isNaN(num) === false) {
        payload[field.name] = num;
      }
      continue;
    }

    if (field.type === 'object') {
      const parsed = isJsonObject(raw) ? raw : parseJsonObjectText(String(raw));
      if (parsed !== null) {
        payload[field.name] = parsed;
      }
      continue;
    }

    payload[field.name] = raw;
  }
  return payload;
}

/**
 * The first reason this set of fields would not register, phrased for the person
 * editing it, or `null` when it is fine to save.
 *
 * Two of the three checks are the form's job rather than the schema's: a
 * duplicate name is valid Zod but shadows the earlier field, because the payload
 * is a JSON object keyed by name, and a `select` with no options gives the
 * person starting a run nothing to pick.
 */
export function triggerInputIssue(fields: TriggerInputField[]): string | null {
  const seen = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const name = field.name.trim();
    if (name === '') return `Input ${String(index + 1)} needs a name.`;
    if (seen.has(name)) return `Two inputs are named ${name}. Each name has to be different.`;
    seen.add(name);
    if (
      (field.type === 'select' || field.type === 'multiselect') &&
      (field.options ?? []).length === 0
    ) {
      return `${name} is a choice list, so it needs at least one option.`;
    }
  }
  return null;
}

/**
 * What registers, given what the form holds. Names are trimmed because steps
 * read a value as `${triggerPayload.<name>}`, which cannot name a field with a
 * space in it, and an empty description or option list is dropped rather than
 * stored as a blank.
 */
export function normalizeTriggerInput(fields: TriggerInputField[]): TriggerInputField[] {
  return fields.map((field) => {
    const { description, options, ...rest } = field;
    const keptDescription = description?.trim();
    const keptOptions = options?.filter((option) => option.trim() !== '');
    return {
      ...rest,
      name: field.name.trim(),
      ...(keptDescription === undefined || keptDescription === '' ? {} : { description: keptDescription }),
      ...(keptOptions === undefined || keptOptions.length === 0 ? {} : { options: keptOptions }),
    };
  });
}
