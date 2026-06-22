import { createRouteAdapter } from '@/lib/route-adapter';
import { archiveWorkflow } from '@mediforce/platform-api/handlers';
import { ArchiveAllInputSchema, type ArchiveAllInput } from '@mediforce/platform-api/contract';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ name: string }>;
}

const ScopedSchema = ArchiveAllInputSchema.extend({
  namespace: z.string().min(1),
});

/**
 * POST /api/workflow-definitions/:name/archive?namespace=… body: { archived }
 */
export const POST = createRouteAdapter<
  typeof ScopedSchema,
  ArchiveAllInput & { namespace: string },
  unknown,
  RouteContext
>(
  ScopedSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, name, namespace: namespace ?? undefined };
  },
  archiveWorkflow,
);
