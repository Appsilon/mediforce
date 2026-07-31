import { calculateEstimatedCost, type AgentRun } from '@mediforce/platform-core';
import { formatCostUsd } from './format';

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
}

/**
 * "no data" covers everything that makes the cost unknowable — no envelope,
 * no recorded token usage, no model, or a model the registry doesn't carry
 * pricing for. Distinct from a genuinely $0.00 run (e.g. a free/local
 * model), which formats through the normal cost formatter.
 */
export function formatAgentRunCost(
  run: AgentRun,
  pricingByModelId: Map<string, ModelPricing>,
): string {
  const envelope = run.envelope;
  if (!envelope?.tokenUsage || !envelope.model) return 'no data';
  const pricing = pricingByModelId.get(envelope.model);
  if (!pricing) return 'no data';
  return formatCostUsd(calculateEstimatedCost(envelope.tokenUsage, pricing));
}
