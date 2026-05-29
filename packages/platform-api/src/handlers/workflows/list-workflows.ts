import type { CallerScope } from '../../repositories/index';
import type {
  ListWorkflowsInput,
  ListWorkflowsOutput,
  WorkflowDefinitionGroupSummary,
} from '../../contract/workflows';

/**
 * List workflow definitions visible to the caller, grouped by name with the
 * latest version pre-resolved. The wrapper filters groups whose latest
 * version the caller cannot see (private + foreign workspace). The optional
 * `namespace` input narrows further but does not grant access.
 */
export async function listWorkflows(
  input: ListWorkflowsInput,
  scope: CallerScope,
): Promise<ListWorkflowsOutput> {
  const groups = await scope.workflowDefinitions.listGroups(false);
  const summaries: WorkflowDefinitionGroupSummary[] = groups.map((group) => {
    const latest = group.versions.find((v) => v.version === group.latestVersion) ?? null;
    return {
      namespace: group.namespace,
      name: group.name,
      latestVersion: group.latestVersion,
      defaultVersion: group.defaultVersion,
      definition: latest,
    };
  });

  const filtered =
    input.namespace !== undefined
      ? summaries.filter((item) => item.namespace === input.namespace)
      : summaries;

  return { definitions: filtered };
}
