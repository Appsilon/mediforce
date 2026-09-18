import { createRouteAdapter } from '@/lib/route-adapter';
import {
  PullImageCatalogVersionInputSchema,
  type PullImageCatalogVersionInput,
} from '@mediforce/platform-api/contract';
import { pullImageCatalogVersion } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter<
  typeof PullImageCatalogVersionInputSchema,
  PullImageCatalogVersionInput
>(
  PullImageCatalogVersionInputSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  pullImageCatalogVersion,
);

/** A pull downloads whole images; the platform default cuts it off long before
 *  a large one lands. */
export const maxDuration = 1800;
