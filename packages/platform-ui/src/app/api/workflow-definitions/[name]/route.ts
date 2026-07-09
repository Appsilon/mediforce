import { createRouteAdapter } from '@/lib/route-adapter';
import {
  getWorkflow,
  setWorkflowVisibility,
  deleteWorkflow,
} from '@mediforce/platform-api/handlers';
import {
  GetWorkflowInputSchema,
  SetVisibilityInputSchema,
  DeleteWorkflowInputSchema,
  type GetWorkflowInput,
  type SetVisibilityInput,
  type DeleteWorkflowInput,
} from '@mediforce/platform-api/contract';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name — fetch one (404 anti-enum on private).
 */
export const GET = createRouteAdapter<
  typeof GetWorkflowInputSchema,
  GetWorkflowInput,
  unknown,
  RouteContext
>(
  GetWorkflowInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const versionParam = req.nextUrl.searchParams.get('version');
    const namespaceParam = req.nextUrl.searchParams.get('namespace');
    const input: Record<string, unknown> = { name };
    if (versionParam !== null) {
      const parsed = Number(versionParam);
      input.version = Number.isFinite(parsed) ? parsed : versionParam;
    }
    if (namespaceParam !== null) input.namespace = namespaceParam;
    return input;
  },
  getWorkflow,
);

const PatchScopedSchema = SetVisibilityInputSchema.extend({
  namespace: z.string().min(1),
});

/**
 * PATCH /api/workflow-definitions/:name?namespace=… — set visibility.
 */
export const PATCH = createRouteAdapter<
  typeof PatchScopedSchema,
  SetVisibilityInput & { namespace: string },
  unknown,
  RouteContext
>(
  PatchScopedSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, name, namespace: namespace ?? undefined };
  },
  setWorkflowVisibility,
);

/**
 * Soft-deletes definition + cascades to runs + human-tasks. `expectedRunCount`
 * is a stale-confirmation guard. Audit actor is sourced from the caller, not
 * hard-coded.
 */
export const DELETE = createRouteAdapter<
  typeof DeleteWorkflowInputSchema,
  DeleteWorkflowInput,
  unknown,
  RouteContext
>(
  DeleteWorkflowInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, name, namespace: namespace ?? undefined };
  },
  deleteWorkflow,
);
