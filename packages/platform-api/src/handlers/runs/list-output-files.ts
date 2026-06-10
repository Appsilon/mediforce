import { WorkspaceReader, type OutputFileEntry } from '@mediforce/agent-runtime';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type {
  ListRunOutputFilesInput,
  ListRunOutputFilesOutput,
} from '../../contract/runs';

/**
 * List the Output Files of one run — artifacts the runtime committed under
 * `.mediforce/output/<stepId>/` on the run branch `run/<runId>` of the
 * workflow's bare repo. Read straight from git, no worktree needed.
 *
 * Out-of-scope ids surface as 404 (anti-enumeration — same shape as a truly
 * missing run, so non-members cannot probe ownership). Runs that never
 * produced Output Files (or pre-date the workspace runtime) return `[]`.
 *
 * `workspaceReader` is injectable for unit tests; production callers (the
 * route adapter) pass only `(input, scope)` and get the default reader,
 * which resolves the bare repo under `MEDIFORCE_DATA_DIR ?? ~/.mediforce`.
 */
export async function listRunOutputFiles(
  input: ListRunOutputFilesInput,
  scope: CallerScope,
  workspaceReader: {
    listOutputFiles: (
      workflow: { name: string; namespace?: string },
      runId: string,
    ) => Promise<OutputFileEntry[]>;
  } = new WorkspaceReader(),
): Promise<ListRunOutputFilesOutput> {
  const run = await scope.runs.getById(input.runId);
  if (run === null) {
    throw new NotFoundError(`Run ${input.runId} not found`);
  }

  const files = await workspaceReader.listOutputFiles(
    { name: run.definitionName, namespace: run.namespace },
    input.runId,
  );
  return { files };
}
