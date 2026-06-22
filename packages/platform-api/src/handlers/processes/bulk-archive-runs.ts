import type { BulkRunInput, BulkRunOutput, BulkRunResultItem } from '../../contract/processes';
import type { CallerScope } from '../../repositories/index';
import { HandlerError } from '../../errors';
import { archiveRun } from './archive-run';

// Always archives (no unarchive bulk path today — matches legacy behaviour).
export async function bulkArchiveRuns(input: BulkRunInput, scope: CallerScope): Promise<BulkRunOutput> {
  const results: BulkRunResultItem[] = await Promise.all(
    input.runIds.map(async (id): Promise<BulkRunResultItem> => {
      try {
        await archiveRun({ runId: id, archived: true }, scope);
        return { id, status: 'ok' };
      } catch (err) {
        const message =
          err instanceof HandlerError ? err.message : err instanceof Error ? err.message : 'Unknown error';
        return { id, status: 'error', error: message };
      }
    }),
  );
  return { results };
}
