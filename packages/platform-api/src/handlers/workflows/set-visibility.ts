import type {
  SetVisibilityInput,
  SetVisibilityOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import { actorFromCaller } from '../_helpers';
import { assertCallerMayEditWorkflow } from './_access-gate';
import { assertStepsMayAddSkills } from '../skills/may-hold-skills';

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

  // ADR-0019 `edit` — after the 404, so a gated workflow and a missing one
  // still look the same to someone who may not touch either.
  await assertCallerMayEditWorkflow(scope, input.namespace, input.name);

  // Only the latest version is checked, as on a transfer (ADR-0027 §7): an
  // older one that reaches a private Skill fails at run time, naming the step.
  if (input.visibility === 'public') {
    const latest = await scope.workflowDefinitions.get(input.namespace, input.name, latestVersion);
    if (latest !== null) await assertStepsMayAddSkills({ ...latest, visibility: 'public' }, scope);
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
    namespace: input.namespace,
  });

  return { success: true as const, name: input.name, visibility: input.visibility };
}
