import type {
  SetVisibilityInput,
  SetVisibilityOutput,
} from '../../contract/workflows.js';
import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import { actorFromCaller } from '../_helpers.js';

interface ScopedInput extends SetVisibilityInput {
  namespace: string;
}

export async function setWorkflowVisibility(
  input: ScopedInput,
  scope: CallerScope,
): Promise<SetVisibilityOutput> {
  const latestVersion = await scope.workflowDefinitions.getLatestVersion(
    input.namespace,
    input.name,
  );
  if (latestVersion === 0) {
    throw new NotFoundError(`Workflow '${input.name}' not found`);
  }

  await scope.workflowDefinitions.setVisibility(input.namespace, input.name, input.visibility);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'workflow.visibility_changed',
    description: `Workflow '${input.name}' visibility set to ${input.visibility}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, name: input.name },
    outputSnapshot: { visibility: input.visibility },
    basis: 'Workflow visibility changed via API',
    entityType: 'workflow_definition',
    entityId: input.name,
  });

  return { success: true as const, name: input.name, visibility: input.visibility };
}
