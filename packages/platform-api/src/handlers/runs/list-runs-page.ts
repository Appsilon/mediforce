import type { ListRunsPageInput, ListRunsPageOutput } from '../../contract/runs';
import type { CallerScope } from '../../repositories/index';

/**
 * Keyset-paginated workflow run list (newest-first by default; Started/Cost
 * ordering is selectable) — see
 * `ListRunsPageInputSchema`'s docstring for why this is separate from
 * `listRuns`. Workspace gating is enforced by the `scope.runs` wrapper,
 * same as `listRuns`.
 */
export async function listRunsPage(
  input: ListRunsPageInput,
  scope: CallerScope,
): Promise<ListRunsPageOutput> {
  const page = await scope.runs.listPage({
    definitionName: input.workflow,
    namespace: input.namespace,
    dryRun: input.dryRun,
    archived: input.archived,
    displayStatus: input.displayStatus,
    sort: input.sort === 'cost' ? 'cost' : 'createdAt',
    direction: input.direction ?? 'desc',
    cursor: input.cursor,
    limit: input.limit,
  });
  return { runs: [...page.items], nextCursor: page.nextCursor };
}
