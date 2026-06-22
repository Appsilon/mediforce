import { createRouteAdapter } from '@/lib/route-adapter';
import { transferWorkflowNamespace } from '@mediforce/platform-api/handlers';
import { TransferWorkflowInputSchema, type TransferWorkflowInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * POST /api/workflow-definitions/:name/transfer
 * body: { sourceNamespace, targetNamespace }
 *
 * Requires caller membership on BOTH source and target namespaces; the write
 * goes through the repository (not raw Firestore) and emits a
 * `workflow.transferred` audit event.
 */
export const POST = createRouteAdapter<
  typeof TransferWorkflowInputSchema,
  TransferWorkflowInput,
  unknown,
  RouteContext
>(
  TransferWorkflowInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, name };
  },
  transferWorkflowNamespace,
);
