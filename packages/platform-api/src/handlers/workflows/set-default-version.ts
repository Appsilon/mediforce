import type {
  SetDefaultVersionInput,
  SetDefaultVersionOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller, loadOr404 } from '../_helpers';
import { assertCallerMayEditWorkflow } from './_access-gate';

export async function setDefaultWorkflowVersion(
  input: SetDefaultVersionInput,
  scope: CallerScope,
): Promise<SetDefaultVersionOutput> {
  const previousDefault = await scope.workflowDefinitions.getDefaultVersion(
    input.namespace,
    input.name,
  );

  await loadOr404(
    scope.workflowDefinitions.get(input.namespace, input.name, input.version),
    `Version ${input.version} not found for workflow '${input.name}'`,
  );

  // ADR-0019 `edit`. Not named in #1253's table, and included for the reason
  // the table gives for grouping: moving the default version decides which
  // version every future unpinned run executes, which is a change to the
  // workflow by any reading. Leaving it out would mean a caller refused the
  // register could still swap the version that runs.
  await assertCallerMayEditWorkflow(scope, input.namespace, input.name);

  await scope.workflowDefinitions.setDefaultVersion(input.namespace, input.name, input.version);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'workflow.default_version_changed',
    description: `Workflow '${input.name}' default version set to ${input.version}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace: input.namespace,
      name: input.name,
      previousDefault: previousDefault ?? null,
    },
    outputSnapshot: { defaultVersion: input.version },
    basis: 'Workflow default version changed via API',
    entityType: 'workflow_definition',
    entityId: input.name,
    namespace: input.namespace,
  });

  return {
    success: true as const,
    name: input.name,
    namespace: input.namespace,
    version: input.version,
  };
}
