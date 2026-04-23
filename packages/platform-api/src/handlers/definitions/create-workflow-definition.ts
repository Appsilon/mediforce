import type { ProcessRepository } from '@mediforce/platform-core';
import type {
  CreateWorkflowDefinitionInput,
  CreateWorkflowDefinitionOutput,
} from '../../contract/definitions.js';
import { ConflictError } from '../../errors.js';

export interface CreateWorkflowDefinitionDeps {
  processRepo: ProcessRepository;
}

/**
 * Pure handler for `POST /api/workflow-definitions`.
 *
 * Auto-increments `version` based on the latest version persisted for the
 * workflow `name`. `namespace` is required by the contract and overrides
 * any namespace embedded in the draft body — preserves pre-migration
 * semantics where the query param won.
 */
export async function createWorkflowDefinition(
  input: CreateWorkflowDefinitionInput,
  deps: CreateWorkflowDefinitionDeps,
): Promise<CreateWorkflowDefinitionOutput> {
  const latestVersion = await deps.processRepo.getLatestWorkflowVersion(
    input.draft.name,
  );
  const nextVersion = latestVersion + 1;

  const definition = {
    ...input.draft,
    namespace: input.namespace,
    version: nextVersion,
    createdAt: new Date().toISOString(),
  };

  try {
    await deps.processRepo.saveWorkflowDefinition(definition);
  } catch (err) {
    if (
      err instanceof Error &&
      err.name === 'WorkflowDefinitionVersionAlreadyExistsError'
    ) {
      throw new ConflictError('Version conflict — please retry.');
    }
    throw err;
  }

  return { success: true, name: definition.name, version: definition.version };
}
