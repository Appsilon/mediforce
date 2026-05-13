import type { AgentRun } from '@mediforce/platform-core';
import type { AgentOutputData } from '@/components/tasks/task-utils';

/**
 * Map an `AgentOutputEnvelope` (Firestore source of truth) into the
 * UI-friendly `AgentOutputData` shape consumed by `AgentOutputDisplay`.
 *
 * NOTE: `AgentOutputEnvelope` schema doesn't carry `estimatedCostUsd` (see
 * `agent-output-envelope.ts`). Cost calculation needs the model registry
 * which is server-only, so we surface `null` here and rely on the existing
 * server-side `estimateCostField` (in `execute-agent-step.ts`) to populate
 * cost on `StepExecution.agentOutput` for the legacy display path.
 */
export function agentOutputFromEnvelope(
  envelope: NonNullable<AgentRun['envelope']>,
): AgentOutputData {
  return {
    confidence: envelope.confidence,
    confidence_rationale: envelope.confidence_rationale ?? null,
    reasoning: envelope.reasoning_summary,
    result: envelope.result,
    model: envelope.model,
    duration_ms: envelope.duration_ms,
    gitMetadata: envelope.gitMetadata ?? null,
    presentation: envelope.presentation ?? null,
    escalationReason: null,
    estimatedCostUsd: null,
    tokenUsage: envelope.tokenUsage ?? null,
  };
}
