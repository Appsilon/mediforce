import { createRouteAdapter } from '@/lib/route-adapter';
import { copyWorkflow } from '@mediforce/platform-api/handlers';
import {
  CopyWorkflowInputSchema,
  type CopyWorkflowInput,
} from '@mediforce/platform-api/contract';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ name: string }>;
}

const ScopedSchema = CopyWorkflowInputSchema.extend({
  targetNamespace: z.string().min(1),
  sourceNamespace: z.string().min(1).optional(),
});

/**
 * POST /api/workflow-definitions/:name/copy?targetNamespace=…&namespace=…
 *
 * Cross-namespace copy. Source: visibility-gated read (public sources are
 * copyable). Target: membership-gated write. Audit emission added.
 */
export const POST = createRouteAdapter<
  typeof ScopedSchema,
  CopyWorkflowInput & { targetNamespace: string; sourceNamespace?: string },
  unknown,
  RouteContext
>(
  ScopedSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const targetNamespace = req.nextUrl.searchParams.get('targetNamespace');
    const sourceNamespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      name,
      targetNamespace: targetNamespace ?? undefined,
      ...(sourceNamespace !== null ? { sourceNamespace } : {}),
    };
  },
  copyWorkflow,
);
