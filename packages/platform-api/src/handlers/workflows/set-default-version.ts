import type { SetDefaultVersionInput, SetDefaultVersionOutput } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller, loadOr404 } from '../_helpers';

export async function setDefaultWorkflowVersion(
  input: SetDefaultVersionInput,
  scope: CallerScope,
): Promise<SetDefaultVersionOutput> {
  const previousDefault = await scope.workflowDefinitions.getDefaultVersion(input.namespace, input.name);

  await loadOr404(
    scope.workflowDefinitions.get(input.namespace, input.name, input.version),
    `Version ${input.version} not found for workflow '${input.name}'`,
  );

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
