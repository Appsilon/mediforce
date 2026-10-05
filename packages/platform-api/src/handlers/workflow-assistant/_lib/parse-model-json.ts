import type { z } from 'zod';
import { unfence } from '@mediforce/platform-core';

// The JSON object out of a reply, whatever the model wrapped around it.
export function parseModelJson<T>(content: string, schema: z.ZodType<T>): T | null {
  const candidate = unfence(content);
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
