const CODE_FENCE = /```[a-z]*\s*([\s\S]*?)\s*```/i;

/** The body of the first markdown code fence in a model's reply, or the whole reply trimmed when it has none. */
export function unfence(text: string): string {
  return (CODE_FENCE.exec(text)?.[1] ?? text).trim();
}
