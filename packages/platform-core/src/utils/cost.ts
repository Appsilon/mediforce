export function calculateEstimatedCost(
  tokenUsage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
  pricing: { input: number; output: number; cacheRead?: number },
): number {
  const cachedInputTokens = tokenUsage.cachedInputTokens ?? 0;
  const cacheReadPrice = pricing.cacheRead ?? pricing.input;
  return (
    tokenUsage.inputTokens * pricing.input +
    cachedInputTokens * cacheReadPrice +
    tokenUsage.outputTokens * pricing.output
  );
}
