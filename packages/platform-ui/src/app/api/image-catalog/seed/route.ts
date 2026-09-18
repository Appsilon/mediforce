import { createRouteAdapter } from '@/lib/route-adapter';
import {
  SeedImageCatalogEntriesInputSchema,
  type SeedImageCatalogEntriesInput,
} from '@mediforce/platform-api/contract';
import { seedImageCatalogEntries } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter<
  typeof SeedImageCatalogEntriesInputSchema,
  SeedImageCatalogEntriesInput
>(
  SeedImageCatalogEntriesInputSchema,
  (req) => ({ namespace: new URL(req.url).searchParams.get('namespace') ?? '' }),
  seedImageCatalogEntries,
);
