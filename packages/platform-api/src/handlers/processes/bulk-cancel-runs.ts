import type { BulkRunInput, BulkRunOutput, BulkRunResultItem } from '../../contract/processes';
import type { CallerScope } from '../../repositories/index';
import { HandlerError } from '../../errors';
import { cancelRun } from './cancel-run';

// Reuses the single-run `cancelRun` handler per id — same audit emission, same
// state-machine guard, same wrapper gating. Per-item failures surface in the
// result array with `status: 'error'`; the batch never aborts.
export async function bulkCancelRuns(input: BulkRunInput, scope: CallerScope): Promise<BulkRunOutput> {
  const results: BulkRunResultItem[] = await Promise.all(
    input.runIds.map(async (id): Promise<BulkRunResultItem> => {
      try {
        await cancelRun({ runId: id }, scope);
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
