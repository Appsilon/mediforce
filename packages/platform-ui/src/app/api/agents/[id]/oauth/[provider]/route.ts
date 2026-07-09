import { createRouteAdapter } from '@/lib/route-adapter';
import {
  getAgentOAuthToken,
  deleteAgentOAuthToken,
} from '@mediforce/platform-api/handlers';
import {
  GetAgentOAuthTokenInputSchema,
  DeleteAgentOAuthTokenInputSchema,
  type GetAgentOAuthTokenInput,
  type DeleteAgentOAuthTokenInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string; provider: string }>;
}

/**
 * GET /api/agents/:id/oauth/:provider?namespace=…&serverName=…
 *
 * Single-binding sanitized read. Useful for the OAuth detail panel — the
 * list endpoint returns the same shape; this just lets callers fetch one
 * without round-trip filtering.
 */
export const GET = createRouteAdapter<
  typeof GetAgentOAuthTokenInputSchema,
  GetAgentOAuthTokenInput,
  unknown,
  RouteContext
>(
  GetAgentOAuthTokenInputSchema,
  async (req, ctx) => {
    const { id, provider } = await ctx.params;
    return {
      id,
      provider,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
      serverName: req.nextUrl.searchParams.get('serverName') ?? undefined,
    };
  },
  getAgentOAuthToken,
);

/**
 * DELETE /api/agents/:id/oauth/:provider?namespace=…&serverName=…&revokeAtProvider=…
 *
 * Local-delete + optional provider-side revoke (fire-and-forget).
 */
export const DELETE = createRouteAdapter<
  typeof DeleteAgentOAuthTokenInputSchema,
  DeleteAgentOAuthTokenInput,
  unknown,
  RouteContext
>(
  DeleteAgentOAuthTokenInputSchema,
  async (req, ctx) => {
    const { id, provider } = await ctx.params;
    return {
      id,
      provider,
      namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
      serverName: req.nextUrl.searchParams.get('serverName') ?? undefined,
      revokeAtProvider: req.nextUrl.searchParams.get('revokeAtProvider') === 'true',
    };
  },
  deleteAgentOAuthToken,
);
