import { z } from 'zod';

export type ParsedToolArguments<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; validationError: string; expectedArguments: z.core.JSONSchema.BaseSchema };

/** Extra words for one validation issue, e.g. what the model should have sent instead. */
export type ToolIssueHint = (issue: z.core.$ZodIssue, received: unknown) => string;

function valueAtPath(input: unknown, path: readonly PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

const CODE_FENCE = /^```[a-z]*\s*([\s\S]*?)\s*```$/i;

/** Escape the raw control characters (newlines in a script, tabs) a model leaves inside JSON strings. */
function escapeControlCharactersInStrings(text: string): string {
  let escaped = '';
  let inString = false;
  let backslashed = false;
  for (const character of text) {
    if (inString === true && backslashed === false && character < ' ') {
      escaped += JSON.stringify(character).slice(1, -1);
      continue;
    }
    if (backslashed === true) backslashed = false;
    else if (character === '\\') backslashed = true;
    else if (character === '"') inString = !inString;
    escaped += character;
  }
  return escaped;
}

function decodeObjectString(value: string): object | undefined {
  const trimmed = value.trim();
  const unfenced = CODE_FENCE.exec(trimmed)?.[1] ?? trimmed;
  for (const candidate of [unfenced, escapeControlCharactersInStrings(unfenced)]) {
    try {
      const decoded: unknown = JSON.parse(candidate);
      if (decoded !== null && typeof decoded === 'object') return decoded;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** A model sometimes JSON-encodes a nested object into a string; decode those where the schema wants an object or array. */
function decodeStringifiedObjects(rawArguments: unknown, issues: readonly z.core.$ZodIssue[]): unknown {
  const repaired = structuredClone(rawArguments);
  let changed = false;
  for (const issue of issues) {
    if (issue.code !== 'invalid_type' || (issue.expected !== 'object' && issue.expected !== 'array')) continue;
    if (issue.path.length === 0) continue;
    const parent = valueAtPath(repaired, issue.path.slice(0, -1));
    const key = issue.path[issue.path.length - 1]!;
    if (parent === null || typeof parent !== 'object') continue;
    const value = (parent as Record<PropertyKey, unknown>)[key];
    if (typeof value !== 'string') continue;
    const decoded = decodeObjectString(value);
    if (decoded === undefined) continue;
    (parent as Record<PropertyKey, unknown>)[key] = decoded;
    changed = true;
  }
  return changed ? repaired : undefined;
}

// Decoding one level can reveal another encoded one inside it (a check whose schema is a string too).
const MAX_DECODE_PASSES = 3;

/**
 * Validate a tool call's arguments against its registry schema, and on failure
 * say it in the terms the model can act on: the path, the complaint, and what
 * it actually sent there (or in the nearest parent that exists).
 */
export function parseToolArguments<T>(
  toolName: string,
  schema: z.ZodType<T>,
  rawArguments: unknown,
  hint?: ToolIssueHint,
): ParsedToolArguments<T> {
  let decodedArguments = rawArguments;
  let result = schema.safeParse(decodedArguments);
  for (let pass = 0; pass < MAX_DECODE_PASSES && result.success === false; pass++) {
    const decoded = decodeStringifiedObjects(decodedArguments, result.error.issues);
    if (decoded === undefined) break;
    decodedArguments = decoded;
    result = schema.safeParse(decodedArguments);
  }
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    let received = valueAtPath(decodedArguments, issue.path);
    let describedPath = path;
    if (received === undefined && issue.path.length > 0) {
      const parentPath = issue.path.slice(0, -1);
      const parent = valueAtPath(decodedArguments, parentPath);
      if (parent !== undefined) {
        received = parent;
        describedPath = parentPath.join('.') || '(root)';
      }
    }
    const extra = hint === undefined ? '' : hint(issue, received);
    const rendered = JSON.stringify(received);
    const excerpt = rendered !== undefined && rendered.length > 500 ? `${rendered.slice(0, 500)}…` : rendered;
    const gotSuffix = received !== undefined ? ` (you sent for '${describedPath}': ${excerpt})` : '';
    return `${path}: ${issue.message}${extra}${gotSuffix}`;
  }).join('; ');
  return {
    ok: false,
    error: `Invalid arguments for '${toolName}': ${issues}. Resend arguments matching the tool's schema; nested objects must not be encoded as strings.`,
    validationError: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).sort().join('; '),
    expectedArguments: z.toJSONSchema(schema, { io: 'input' }),
  };
}
