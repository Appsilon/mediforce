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
    try {
      const decoded: unknown = JSON.parse(value);
      if (decoded !== null && typeof decoded === 'object') {
        (parent as Record<PropertyKey, unknown>)[key] = decoded;
        changed = true;
      }
    } catch {
      continue;
    }
  }
  return changed ? repaired : undefined;
}

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
  const result = schema.safeParse(rawArguments);
  if (result.success) return { ok: true, data: result.data };
  const decoded = decodeStringifiedObjects(rawArguments, result.error.issues);
  if (decoded !== undefined) {
    const retried = schema.safeParse(decoded);
    if (retried.success) return { ok: true, data: retried.data };
  }
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    let received = valueAtPath(rawArguments, issue.path);
    let describedPath = path;
    if (received === undefined && issue.path.length > 0) {
      const parentPath = issue.path.slice(0, -1);
      const parent = valueAtPath(rawArguments, parentPath);
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
