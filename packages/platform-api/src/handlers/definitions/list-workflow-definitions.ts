import type { ProcessRepository } from '@mediforce/platform-core';
import type {
  ListWorkflowDefinitionsInput,
  ListWorkflowDefinitionsOutput,
} from '../../contract/definitions.js';

export interface ListWorkflowDefinitionsDeps {
  processRepo: ProcessRepository;
}

/**
 * Pure handler: list every workflow definition grouped by name with the
 * latest version pre-resolved. Shape is 1:1 with the pre-migration route.
 */
export async function listWorkflowDefinitions(
  _input: ListWorkflowDefinitionsInput,
  deps: ListWorkflowDefinitionsDeps,
): Promise<ListWorkflowDefinitionsOutput> {
  const { definitions } = await deps.processRepo.listWorkflowDefinitions();
  const result = definitions.map((group) => {
    const latest = group.versions.find((v) => v.version === group.latestVersion) ?? null;
    return {
      name: group.name,
      latestVersion: group.latestVersion,
      defaultVersion: group.defaultVersion,
      definition: latest,
    };
  });
  return { definitions: result };
}
