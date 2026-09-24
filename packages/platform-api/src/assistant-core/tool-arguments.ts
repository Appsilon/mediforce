import type { z } from 'zod';

export type ParsedToolArguments<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
    const gotSuffix = received !== undefined ? ` (you sent for '${describedPath}': ${JSON.stringify(received)})` : '';
    return `${path}: ${issue.message}${extra}${gotSuffix}`;
  }).join('; ');
  return { ok: false, error: `Invalid arguments for '${toolName}': ${issues}` };
}
