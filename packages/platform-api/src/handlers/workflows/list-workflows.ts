import type { CallerScope } from '../../repositories/index';
import type { ListWorkflowsInput, ListWorkflowsOutput, WorkflowDefinitionGroupSummary } from '../../contract/workflows';

/**
 * List workflow definitions visible to the caller, grouped by name with the
 * latest version pre-resolved. The wrapper filters groups whose latest
 * version the caller cannot see (private + foreign workspace). The optional
 * `namespace` input narrows further but does not grant access.
 */
export async function listWorkflows(input: ListWorkflowsInput, scope: CallerScope): Promise<ListWorkflowsOutput> {
  const groups = await scope.workflowDefinitions.listGroups(false);

  const inScope =
    input.namespace !== undefined ? groups.filter((group) => group.namespace === input.namespace) : groups;

  // One run summary per card. The summaries come from count() aggregations +
  // a bounded latest-3 query (no full-collection read), so fanning out here
  // is cheap — there is no N+1-of-reads, just N cheap aggregations. The home
  // page previously re-fetched up to 10k run docs every poll to compute the
  // same numbers client-side.
  const summaries: WorkflowDefinitionGroupSummary[] = await Promise.all(
    inScope.map(async (group) => {
      const latest = group.versions.find((v) => v.version === group.latestVersion) ?? null;
      const rawSummary = await scope.runs.summarizeRuns(group.namespace, group.name, input.includeCompletedRuns);

      const stepsByVersion: Record<string, string[]> = {};
      for (const instance of rawSummary.latest) {
        const key = instance.definitionVersion;
        if (key === null) continue;
        if (!(key in stepsByVersion)) {
          const def = group.versions.find((v) => String(v.version) === instance.definitionVersion);
          if (def) {
            stepsByVersion[key] = def.steps.filter((s) => s.type !== 'terminal').map((s) => s.id);
          }
        }
      }

      return {
        namespace: group.namespace,
        name: group.name,
        latestVersion: group.latestVersion,
        defaultVersion: group.defaultVersion,
        definition: latest,
        runSummary: { ...rawSummary, stepsByVersion },
      };
    }),
  );

  return { definitions: summaries };
}
