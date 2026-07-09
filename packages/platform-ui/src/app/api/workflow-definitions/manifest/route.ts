import { createRouteAdapter } from '@/lib/route-adapter';
import { getManifest } from '@mediforce/platform-api/handlers';
import { GetManifestInputSchema } from '@mediforce/platform-api/contract';

export const GET = createRouteAdapter(
  GetManifestInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      repo: params.get('repo') ?? undefined,
      ref: params.get('ref') ?? undefined,
    };
  },
  getManifest,
);
