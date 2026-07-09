import { createRouteAdapter } from '@/lib/route-adapter';
import { bulkArchiveRuns } from '@mediforce/platform-api/handlers';
import { BulkRunInputSchema } from '@mediforce/platform-api/contract';
import type { BulkRunInput } from '@mediforce/platform-api/contract';

/**
 * POST /api/processes/bulk/archive  body: { runIds: string[] }
 *
 * Per-item archive (always `archived: true`); per-item failures surface as
 * `{ id, status: 'error', error }` entries per ADR-0005 §5.
 */
export const POST = createRouteAdapter<typeof BulkRunInputSchema, BulkRunInput>(
  BulkRunInputSchema,
  async (req) => (await req.json().catch(() => ({}))),
  bulkArchiveRuns,
);
