import { createRouteAdapter } from '@/lib/route-adapter';
import {
  CreateOAuthProviderInputApiSchema,
  ListOAuthProvidersInputSchema,
  type CreateOAuthProviderInputApi,
  type ListOAuthProvidersInput,
} from '@mediforce/platform-api/contract';
import {
  createOAuthProvider,
  listOAuthProviders,
} from '@mediforce/platform-api/handlers';

export const GET = createRouteAdapter<
  typeof ListOAuthProvidersInputSchema,
  ListOAuthProvidersInput
>(
  ListOAuthProvidersInputSchema,
  (req) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
  }),
  listOAuthProviders,
);

export const POST = createRouteAdapter<
  typeof CreateOAuthProviderInputApiSchema,
  CreateOAuthProviderInputApi
>(
  CreateOAuthProviderInputApiSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  createOAuthProvider,
  { successStatus: 201 },
);
