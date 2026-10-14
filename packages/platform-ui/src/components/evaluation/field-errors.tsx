import type { ZodError } from 'zod';

/** The line a browser's JSON.parse message points at: V8 and Firefox name it, or give an offset into the text. */
function errorLine(text: string, message: string): number | null {
  const line = /line (\d+)/.exec(message);
  if (line !== null) return Number(line[1]);
  const position = /position (\d+)/.exec(message);
  if (position !== null) return text.slice(0, Number(position[1])).split('\n').length;
  return null;
}

/** JSON text as a value, or where it breaks, in words a person can act on. */
export function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    const line = error instanceof Error ? errorLine(text, error.message) : null;
    return { error: `Not valid JSON${line === null ? '' : ` (line ${line})`} — check for a missing comma, quote or bracket.` };
  }
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'true/false';
  return 'something else';
}

function valueAt(value: unknown, path: readonly PropertyKey[]): { found: boolean; value: unknown } {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || (key in current) === false) return { found: false, value: undefined };
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return { found: true, value: current };
}

/** What a schema rejected in a value, one plain sentence per field. */
export function describeIssues(issues: ZodError['issues'], value: unknown): string {
  return issues.map((issue) => {
    const field = issue.path.length === 0 ? null : `"${issue.path.map(String).join('.')}"`;
    const objectExpected = issue.code === 'invalid_type' && (issue.expected === 'record' || issue.expected === 'object');
    const actual = valueAt(value, issue.path);
    if (field === null) return objectExpected ? `It must be an object { … }, not ${kindOf(value)}.` : `${issue.message}.`;
    if (actual.found === false) return `${field} is missing${objectExpected ? ' — add it, even as {}' : ''}.`;
    if (objectExpected) return `${field} must be an object { … }, not ${kindOf(actual.value)}.`;
    return `${field}: ${issue.message}.`;
  }).join(' ');
}

export const invalidClass = 'border-destructive focus-visible:ring-destructive';

/** Why a field blocks a save, said under it. */
export function FieldError({ message, testId }: { message: string | undefined; testId?: string }) {
  if (message === undefined) return null;
  return <p role="alert" className="text-xs text-destructive" data-testid={testId}>{message}</p>;
}
