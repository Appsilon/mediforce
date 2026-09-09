import type { z } from 'zod';

/**
 * The JSON object out of a reply, whatever the model wrapped around it.
 *
 * Two turns ask for a bare JSON object — the plan before a build, and the
 * question a build that could not finish comes back with — and neither can rely
 * on getting one: a fenced block is the common wrapping, a sentence either side
 * is the give-up case. Returns null rather than throwing, because both callers
 * degrade to something useful when the shape is unreadable.
 */
export function parseModelJson<T>(content: string, schema: z.ZodType<T>): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = (fenced?.[1] ?? content).trim();
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
