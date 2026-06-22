import { createRouteAdapter } from '@/lib/route-adapter';
import {
  CreateToolCatalogEntryInputApiSchema,
  ListToolCatalogEntriesInputSchema,
  type CreateToolCatalogEntryInputApi,
  type ListToolCatalogEntriesInput,
} from '@mediforce/platform-api/contract';
import { createToolCatalogEntry, listToolCatalogEntries } from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter<typeof ListToolCatalogEntriesInputSchema, ListToolCatalogEntriesInput>(
  ListToolCatalogEntriesInputSchema,
  (req) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
  }),
  listToolCatalogEntries,
);

export const POST = createRouteAdapter<typeof CreateToolCatalogEntryInputApiSchema, CreateToolCatalogEntryInputApi>(
  CreateToolCatalogEntryInputApiSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  createToolCatalogEntry,
  { successStatus: 201 },
);
