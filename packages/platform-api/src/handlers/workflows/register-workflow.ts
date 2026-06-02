import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { validateRetiredModels } from '@mediforce/agent-runtime';
import type {
  RegisterWorkflowInput,
  RegisterWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import {
  ConflictError,
  ForbiddenError,
  HandlerError,
  ValidationError,
} from '../../errors';
import { actorFromCaller } from '../_helpers';

interface RegisterScopedInput extends RegisterWorkflowInput {
  namespace: string;
}

export async function registerWorkflow(
  input: RegisterScopedInput,
  scope: CallerScope,
): Promise<RegisterWorkflowOutput> {
  if (typeof input.namespace !== 'string' || input.namespace.length === 0) {
    throw new ForbiddenError('Missing required query parameter: namespace');
  }

  const isDeleted = await scope.workflowDefinitions.isNameDeleted(input.namespace, input.name);
  if (isDeleted) {
    throw new ValidationError(
      `The name "${input.name}" was previously used by a deleted workflow. Please choose a different name.`,
    );
  }

  const parsed = parseWorkflowDefinitionForCreation({ ...input, namespace: input.namespace });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
      parsed.error.issues,
    );
  }

  const allModels = await scope.models.list();
  const retiredMap = new Map(
    allModels
      .filter((m) => m.retiredAt !== null)
      .map((m) => [m.id, m.retiredAt!]),
  );
  const retiredRefs = validateRetiredModels(parsed.data, retiredMap);
  if (retiredRefs.length > 0) {
    const detail = retiredRefs
      .map((r) => {
        const stepNames = r.steps.map((s) => `'${s.stepName}'`).join(', ');
        const date = r.retiredAt.slice(0, 10);
        return `model '${r.model}' (retired ${date}) in step(s) ${stepNames}`;
      })
      .join('; ');
    throw new ValidationError(`Cannot save: step(s) use retired model(s): ${detail}`);
  }

  const latestVersion = await scope.workflowDefinitions.getLatestVersion(
    input.namespace,
    parsed.data.name,
  );
  const nextVersion = latestVersion + 1;

  const definition = {
    ...parsed.data,
    version: nextVersion,
    createdAt: new Date().toISOString(),
  };

  try {
    await scope.workflowDefinitions.save(definition);
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (/already exists/i.test(message)) {
      throw new ConflictError('Version conflict — please retry.');
    }
    throw err;
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: nextVersion === 1 ? 'workflow.created' : 'workflow.version_added',
    description: `Workflow '${definition.name}' v${nextVersion} registered in '${input.namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, name: definition.name },
    outputSnapshot: { version: nextVersion },
    basis: 'Workflow definition registered via API',
    entityType: 'workflow_definition',
    entityId: definition.name,
    namespace: input.namespace,
  });

  return { success: true as const, name: definition.name, version: definition.version };
}
