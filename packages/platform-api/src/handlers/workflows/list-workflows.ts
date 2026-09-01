import { memoizeProcessRoleReads } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListWorkflowsInput,
  ListWorkflowsOutput,
  WorkflowDefinitionGroupSummary,
} from '../../contract/workflows';
import { resolveCallerWorkflowVerbs } from './_access-gate';

/**
 * List workflow definitions visible to the caller, grouped by name with the
 * latest version pre-resolved. User callers receive only groups in their
 * member namespaces. The optional `namespace` input narrows further but does
 * not grant access.
 */
export async function listWorkflows(
  input: ListWorkflowsInput,
  scope: CallerScope,
): Promise<ListWorkflowsOutput> {
  const groups = await scope.workflowDefinitions.listGroups(input.includeArchived);

  const inScope =
    input.namespace !== undefined
      ? groups.filter((group) => group.namespace === input.namespace)
      : groups;

  // Hand-start gate reads the `triggers` table (ADR-0011 / Issue #930). One
  // cross-namespace read of enabled manual rows, then a Set lookup per card —
  // no per-card N+1.
  const enabledManual = await scope.system.triggers.listEnabledByType('manual');
  const manualStartByWorkflow = new Set(
    enabledManual.map((t) => `${t.namespace}:${t.workflowName}`),
  );

  // Same shape for the run gate (ADR-0019): one read of the workflows that
  // have one, then a map lookup per card. A workflow absent from the map has
  // no gate, and `resolveCallerWorkflowVerbs` answers `true` for it without
  // touching the role directory — so the common catalog costs one query total.
  // The memo shares the read a narrowed grant needs between the cards that ask
  // the same `(workspace, workflow)` question.
  const accessByWorkflow = await scope.workflowDefinitions.listAccess(
    [...new Set(inScope.map((group) => group.namespace))],
  );
  const roleDirectory = memoizeProcessRoleReads(scope.system.userDirectory);

  // One run summary per card. The summaries come from count() aggregations +
  // a bounded latest-3 query (no full-collection read), so fanning out here
  // is cheap — there is no N+1-of-reads, just N cheap aggregations. The home
  // page previously re-fetched up to 10k run docs every poll to compute the
  // same numbers client-side.
  const summaries: WorkflowDefinitionGroupSummary[] = await Promise.all(
    inScope.map(async (group) => {
      const latest = group.versions.find((v) => v.version === group.latestVersion) ?? null;
      const rawSummary = await scope.runs.summarizeRuns(
        group.namespace,
        group.name,
        input.includeCompletedRuns,
      );

      const stepsByVersion: Record<string, string[]> = {};
      for (const instance of rawSummary.latest) {
        const key = instance.definitionVersion;
        if (key === null) continue;
        if (!(key in stepsByVersion)) {
          const def = group.versions.find((v) => String(v.version) === instance.definitionVersion);
          if (def) {
            stepsByVersion[key] = def.steps
              .filter((s) => s.type !== 'terminal')
              .map((s) => s.id);
          }
        }
      }

      const access = accessByWorkflow.get(`${group.namespace}:${group.name}`);
      const { mayRun } = access === undefined
        ? { mayRun: true }
        : await resolveCallerWorkflowVerbs(
            scope.caller,
            roleDirectory,
            group.namespace,
            group.name,
            access,
          );

      return {
        namespace: group.namespace,
        name: group.name,
        latestVersion: group.latestVersion,
        defaultVersion: group.defaultVersion,
        definition: latest,
        runSummary: { ...rawSummary, stepsByVersion },
        manualStartEnabled: manualStartByWorkflow.has(`${group.namespace}:${group.name}`),
        callerMayRun: mayRun,
      };
    }),
  );

  return { definitions: summaries };
}
