import { createRouteAdapter } from '@/lib/route-adapter';
import {
  BuildImageCatalogVersionInputSchema,
  type BuildImageCatalogVersionInput,
} from '@mediforce/platform-api/contract';
import { buildImageCatalogVersion } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter<
  typeof BuildImageCatalogVersionInputSchema,
  BuildImageCatalogVersionInput
>(
  BuildImageCatalogVersionInputSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  buildImageCatalogVersion,
);

/** A build clones a repo and runs a Dockerfile; the platform default cuts it
 *  off long before that finishes. */
export const maxDuration = 1800;
