import { createRouteAdapter } from '@/lib/route-adapter';
import {
  CreateImageCatalogEntryInputApiSchema,
  ListImageCatalogEntriesInputSchema,
  type CreateImageCatalogEntryInputApi,
  type ListImageCatalogEntriesInput,
} from '@mediforce/platform-api/contract';
import {
  createImageCatalogEntry,
  listImageCatalogEntries,
} from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter<
  typeof ListImageCatalogEntriesInputSchema,
  ListImageCatalogEntriesInput
>(
  ListImageCatalogEntriesInputSchema,
  (req) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
  }),
  listImageCatalogEntries,
);

export const POST = createRouteAdapter<
  typeof CreateImageCatalogEntryInputApiSchema,
  CreateImageCatalogEntryInputApi
>(
  CreateImageCatalogEntryInputApiSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  createImageCatalogEntry,
  { successStatus: 201 },
);
