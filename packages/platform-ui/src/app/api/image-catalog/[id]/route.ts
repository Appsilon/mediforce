import { createRouteAdapter } from '@/lib/route-adapter';
import {
  DeleteImageCatalogEntryInputSchema,
  GetImageCatalogEntryInputSchema,
  UpdateImageCatalogEntryInputApiSchema,
  type DeleteImageCatalogEntryInput,
  type GetImageCatalogEntryInput,
  type UpdateImageCatalogEntryInputApi,
} from '@mediforce/platform-api/contract';
import {
  deleteImageCatalogEntry,
  getImageCatalogEntry,
  updateImageCatalogEntry,
} from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createRouteAdapter<
  typeof GetImageCatalogEntryInputSchema,
  GetImageCatalogEntryInput,
  unknown,
  RouteContext
>(
  GetImageCatalogEntryInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  getImageCatalogEntry,
);

export const PATCH = createRouteAdapter<
  typeof UpdateImageCatalogEntryInputApiSchema,
  UpdateImageCatalogEntryInputApi,
  unknown,
  RouteContext
>(
  UpdateImageCatalogEntryInputApiSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // The path id wins over any `id` in the body. A `source` in the body is
    // passed through: it re-keys the entry, so the handler — which is the only
    // thing that can derive the new id — decides what happens to it.
    const { id: _bodyId, ...rest } = body;
    return {
      ...rest,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
      id: (await ctx.params).id,
    };
  },
  updateImageCatalogEntry,
);

export const DELETE = createRouteAdapter<
  typeof DeleteImageCatalogEntryInputSchema,
  DeleteImageCatalogEntryInput,
  unknown,
  RouteContext
>(
  DeleteImageCatalogEntryInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  deleteImageCatalogEntry,
);
