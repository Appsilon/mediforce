import { createRouteAdapter } from '@/lib/route-adapter';
import { transferWorkflowNamespace } from '@mediforce/platform-api/handlers';
import {
  TransferWorkflowInputSchema,
  type TransferWorkflowInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * POST /api/workflow-definitions/:name/transfer
 * body: { sourceNamespace, targetNamespace }
 *
 * Replaces the pre-Phase-2.5 Server Action. Three bug-fixes vs legacy:
 *   1. Goes through the repository (was: raw Firestore).
 *   2. Asserts caller membership on BOTH source AND target.
 *   3. Emits `workflow.transferred` audit.
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
