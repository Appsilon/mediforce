import type { BulkRunInput, BulkRunOutput, BulkRunResultItem } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { HandlerError } from '../../errors.js';
import { archiveRun } from './archive-run.js';

// Always archives (no unarchive bulk path today — matches legacy behaviour).
export async function bulkArchiveRuns(
  input: BulkRunInput,
  scope: CallerScope,
): Promise<BulkRunOutput> {
  const results: BulkRunResultItem[] = await Promise.all(
    input.runIds.map(async (id): Promise<BulkRunResultItem> => {
      try {
        await archiveRun({ runId: id, archived: true }, scope);
        return { id, status: 'ok' };
      } catch (err) {
        const message = err instanceof HandlerError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown error';
        return { id, status: 'error', error: message };
      }
    }),
  );
  return { results };
}
