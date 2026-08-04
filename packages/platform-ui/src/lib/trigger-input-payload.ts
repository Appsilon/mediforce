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
