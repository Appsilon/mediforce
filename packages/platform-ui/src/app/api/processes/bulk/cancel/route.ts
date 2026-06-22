import { createRouteAdapter } from '@/lib/route-adapter';
import { bulkCancelRuns } from '@mediforce/platform-api/handlers';
import { BulkRunInputSchema } from '@mediforce/platform-api/contract';
import type { BulkRunInput } from '@mediforce/platform-api/contract';

/**
 * POST /api/processes/bulk/cancel  body: { runIds: string[] }
 *
 * Per-item cancel; per-item failures surface as `{ id, status: 'error', error }`
 * entries in the `results` array per ADR-0005 §5. The batch never aborts.
 */
export const POST = createRouteAdapter<typeof BulkRunInputSchema, BulkRunInput>(
  BulkRunInputSchema,
  async (req) => await req.json().catch(() => ({})),
  bulkCancelRuns,
);
