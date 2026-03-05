import type { ZodError } from 'zod';

/**
 * Formats a ZodError into human-readable error messages with field paths.
 *
 * Each issue is rendered as "{path}: {message}" where the path uses dot notation
 * (e.g., "steps.0.type"). Multiple issues are joined with newline characters.
 */
export function formatZodErrors(zodError: ZodError): string {
  return zodError.issues
    .map((issue) => {
      const path = issue.path.join('.');
      if (path) {
        return `${path}: ${issue.message}`;
      }
      return issue.message;
    })
    .join('\n');
}
