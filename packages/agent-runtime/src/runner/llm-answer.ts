import type { z } from 'zod';

/** The JSON object an LLM answered with, read from its first `{` to its last `}`; null when it does not parse to `schema`. */
export function parseAnswer<Answer>(content: string, schema: z.ZodType<Answer>): Answer | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(content.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
