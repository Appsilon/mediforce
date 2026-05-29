import { createRouteAdapter } from '@/lib/route-adapter';
import { listWorkflowSecretKeysBatch } from '@mediforce/platform-api/handlers';
import {
  ListWorkflowSecretKeysBatchInputSchema,
  type ListWorkflowSecretKeysBatchInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-secrets/keys-batch?namespace=…&workflow=A&workflow=B
 *
 * Multi-workflow key listing in one round-trip. Used by the run launcher to
 * decorate workflow rows with "N keys configured".
 */
export const GET = createRouteAdapter<
  typeof ListWorkflowSecretKeysBatchInputSchema,
  ListWorkflowSecretKeysBatchInput
>(
  ListWorkflowSecretKeysBatchInputSchema,
  (req) => ({
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    workflows: req.nextUrl.searchParams.getAll('workflow'),
  }),
  listWorkflowSecretKeysBatch,
);
