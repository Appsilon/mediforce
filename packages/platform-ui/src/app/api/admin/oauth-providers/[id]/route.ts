import { createRouteAdapter } from '@/lib/route-adapter';
import {
  DeleteOAuthProviderInputSchema,
  GetOAuthProviderInputSchema,
  UpdateOAuthProviderInputApiSchema,
  type DeleteOAuthProviderInput,
  type GetOAuthProviderInput,
  type UpdateOAuthProviderInputApi,
} from '@mediforce/platform-api/contract';
import { deleteOAuthProvider, getOAuthProvider, updateOAuthProvider } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createRouteAdapter<typeof GetOAuthProviderInputSchema, GetOAuthProviderInput, unknown, RouteContext>(
  GetOAuthProviderInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  getOAuthProvider,
);

export const PATCH = createRouteAdapter<
  typeof UpdateOAuthProviderInputApiSchema,
  UpdateOAuthProviderInputApi,
  unknown,
  RouteContext
>(
  UpdateOAuthProviderInputApiSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
      id: (await ctx.params).id,
    };
  },
  updateOAuthProvider,
);

export const DELETE = createRouteAdapter<
  typeof DeleteOAuthProviderInputSchema,
  DeleteOAuthProviderInput,
  unknown,
  RouteContext
>(
  DeleteOAuthProviderInputSchema,
  async (req, ctx) => ({
    namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    id: (await ctx.params).id,
  }),
  deleteOAuthProvider,
);
