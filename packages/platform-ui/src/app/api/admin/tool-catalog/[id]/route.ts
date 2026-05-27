import { createRouteAdapter } from '@/lib/route-adapter';
import {
  DeleteToolCatalogEntryInputSchema,
  GetToolCatalogEntryInputSchema,
  UpdateToolCatalogEntryInputApiSchema,
  type DeleteToolCatalogEntryInput,
  type GetToolCatalogEntryInput,
  type UpdateToolCatalogEntryInputApi,
} from '@mediforce/platform-api/contract';
import {
  deleteToolCatalogEntry,
  getToolCatalogEntry,
  updateToolCatalogEntry,
} from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createRouteAdapter<
  typeof GetToolCatalogEntryInputSchema,
  GetToolCatalogEntryInput,
  unknown,
  RouteContext
>(
  GetToolCatalogEntryInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  getToolCatalogEntry,
);

export const PATCH = createRouteAdapter<
  typeof UpdateToolCatalogEntryInputApiSchema,
  UpdateToolCatalogEntryInputApi,
  unknown,
  RouteContext
>(
  UpdateToolCatalogEntryInputApiSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Path id wins over any `id` field in the body — bindings reference id,
    // so the route never allows a rename. The patch schema strips `id` from
    // the partial body; we reinstate it from the URL.
    const { id: _bodyId, ...rest } = body;
    return {
      ...rest,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
      id: (await ctx.params).id,
    };
  },
  updateToolCatalogEntry,
);

export const DELETE = createRouteAdapter<
  typeof DeleteToolCatalogEntryInputSchema,
  DeleteToolCatalogEntryInput,
  unknown,
  RouteContext
>(
  DeleteToolCatalogEntryInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  deleteToolCatalogEntry,
);
