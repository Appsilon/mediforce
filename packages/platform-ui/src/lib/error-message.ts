import { ZodError } from 'zod';

/**
 * One plain sentence for whatever a `mediforce.*` call threw. The Mediforce
 * client validates input with `.parse()` before the request leaves the
 * browser (see `packages/platform-api/src/client/index.ts`), so a blank
 * required field throws a raw `ZodError` straight out of that call — its
 * `.message` is Zod's own `JSON.stringify(issues)`, never meant for a reader.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ZodError) {
    return err.issues.map((issue) => {
      const field = issue.path.length > 0 ? `"${issue.path.map(String).join('.')}"` : null;
      const blank = issue.code === 'too_small' && 'minimum' in issue && issue.minimum === 1;
      const detail = blank ? 'is required' : issue.message;
      return field === null ? `${detail}.` : `${field} ${detail}.`;
    }).join(' ');
  }
  if (err instanceof Error && err.message !== '') return err.message;
  return fallback;
}
