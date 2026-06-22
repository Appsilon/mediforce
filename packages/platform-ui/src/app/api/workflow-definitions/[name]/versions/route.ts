import { createRouteAdapter } from '@/lib/route-adapter';
import { listWorkflowVersions } from '@mediforce/platform-api/handlers';
import { ListWorkflowVersionsInputSchema, type ListWorkflowVersionsInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name/versions?namespace=… — list every
 * version's metadata (no full definition body). Replaces the Firestore
 * `useWorkflowDefinitions` subscription that eager-loaded every version's
 * full payload.
 */
export const GET = createRouteAdapter<
  typeof ListWorkflowVersionsInputSchema,
  ListWorkflowVersionsInput,
  unknown,
  RouteContext
>(
  ListWorkflowVersionsInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const namespace = req.nextUrl.searchParams.get('namespace');
    return { name, namespace: namespace ?? undefined };
  },
  listWorkflowVersions,
);
