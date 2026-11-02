import type { z } from 'zod';

/** Where the object opening at `start` closes, braces inside its strings aside; -1 if it never does. */
function closingBrace(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The JSON object an LLM answered with: the last whole object in its text that
 * parses to `schema`, so a draft gives way to the final answer and prose around
 * it — even prose that quotes JSON or follows it in braces — is skipped. An
 * object nested in valid JSON is part of that JSON, not an answer. Null when
 * none does.
 */
export function parseAnswer<Answer>(content: string, schema: z.ZodType<Answer>): Answer | null {
  let answer: Answer | null = null;
  let start = content.indexOf('{');
  while (start !== -1) {
    const end = closingBrace(content, start);
    const value = end === -1 ? undefined : parsedJson(content.slice(start, end + 1));
    if (value === undefined) {
      // Not an object's opening brace; one may still open inside what it seemed to hold.
      start = content.indexOf('{', start + 1);
    } else {
      const parsed = schema.safeParse(value);
      if (parsed.success) answer = parsed.data;
      start = content.indexOf('{', end + 1);
    }
  }
  return answer;
}
