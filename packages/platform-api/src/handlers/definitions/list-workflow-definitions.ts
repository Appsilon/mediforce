import type { ProcessRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth.js';
import type {
  ListWorkflowDefinitionsInput,
  ListWorkflowDefinitionsOutput,
  WorkflowDefinitionSummary,
} from '../../contract/definitions.js';

export interface ListWorkflowDefinitionsDeps {
  processRepo: ProcessRepository;
}

/**
 * List workflow definitions visible to the caller, grouped by name with the
 * latest version pre-resolved.
 *
 * Visibility rules (preserved from the pre-migration route):
 *   - api-key callers see every group.
 *   - user callers see groups whose latest definition is either marked
 *     `visibility: 'public'` or owned by a namespace they're a member of.
 *   - groups whose latest version is missing (no resolvable definition)
 *     are dropped for user callers — there's nothing safe to show them.
 *
 * The optional `namespace` filter narrows the result further; it does NOT
 * grant access (caller must still be permitted to see the definition).
 */
export async function listWorkflowDefinitions(
  input: ListWorkflowDefinitionsInput,
  deps: ListWorkflowDefinitionsDeps,
  caller: CallerIdentity,
): Promise<ListWorkflowDefinitionsOutput> {
  const { definitions } = await deps.processRepo.listWorkflowDefinitions(false);
  const summaries: WorkflowDefinitionSummary[] = definitions.map((group) => {
    const latest = group.versions.find((v) => v.version === group.latestVersion) ?? null;
    return {
      namespace: group.namespace,
      name: group.name,
      latestVersion: group.latestVersion,
      defaultVersion: group.defaultVersion,
      definition: latest,
    };
  });

  const visible =
    caller.kind === 'apiKey'
      ? summaries
      : summaries.filter((item) => {
          if (item.definition === null) return false;
          if (item.definition.visibility === 'public') return true;
          return caller.namespaces.has(item.definition.namespace);
        });

  const filtered =
    input.namespace !== undefined
      ? visible.filter((item) => item.namespace === input.namespace)
      : visible;

  return { definitions: filtered };
}
