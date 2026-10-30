import type { z } from 'zod';

/**
 * The JSON object an LLM answered with: the first `{` whose text up to the
 * last `}` parses to `schema`, so prose around the answer — even prose that
 * quotes JSON — is skipped. Null when none does.
 */
export function parseAnswer<Answer>(content: string, schema: z.ZodType<Answer>): Answer | null {
  const end = content.lastIndexOf('}');
  for (let start = content.indexOf('{'); start !== -1 && start < end; start = content.indexOf('{', start + 1)) {
    try {
      const parsed = schema.safeParse(JSON.parse(content.slice(start, end + 1)));
      if (parsed.success) return parsed.data;
    } catch {
      // Not the answer's opening brace; try the next one.
    }
  }
  return null;
}
