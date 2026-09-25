import type { AgentOutputGate } from '@mediforce/agent-runtime';
import { hasProductionEvaluators, productionEvaluatorGate } from '@mediforce/platform-api/runtime';
import { defaultBuildScope } from './route-adapter';

/**
 * The output gate a step's production Evaluators put on its runs (ADR-0023 D13),
 * or undefined when it has none. Fails open: a lookup that cannot run leaves the
 * step ungated and reports why through `onError`, since a gate that cannot run
 * is recorded, never a reason for the step not to start.
 */
export async function buildProductionOutputGate(
  step: { namespace: string; workflowName: string; stepId: string },
  onError: (error: unknown) => void,
): Promise<AgentOutputGate | undefined> {
  try {
    const systemScope = defaultBuildScope({ kind: 'apiKey', isSystemActor: true });
    return await hasProductionEvaluators(systemScope, step) ? productionEvaluatorGate(systemScope) : undefined;
  } catch (error) {
    onError(error);
    return undefined;
  }
}
