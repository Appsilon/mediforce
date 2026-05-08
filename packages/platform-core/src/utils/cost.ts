export function calculateEstimatedCost(
  tokenUsage: { inputTokens: number; outputTokens: number },
  pricing: { input: number; output: number },
): number {
  return tokenUsage.inputTokens * pricing.input + tokenUsage.outputTokens * pricing.output;
}
