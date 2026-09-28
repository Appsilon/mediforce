import { createRouteAdapter } from '@/lib/route-adapter';
import {
  PublishImageCatalogVersionInputSchema,
  type PublishImageCatalogVersionInput,
} from '@mediforce/platform-api/contract';
import { publishImageCatalogVersion } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** POST /api/image-catalog/:id/publish?namespace=… — `publishImageCatalogVersion`. */
export const POST = createRouteAdapter<
  typeof PublishImageCatalogVersionInputSchema,
  PublishImageCatalogVersionInput,
  unknown,
  RouteContext
>(
  PublishImageCatalogVersionInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
      id: (await ctx.params).id,
    };
  },
  publishImageCatalogVersion,
);

/** The rebuild runs inside the request, as an upload's does. */
export const maxDuration = 1800;
