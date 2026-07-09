import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentOAuthTokens } from '@mediforce/platform-api/handlers';
import {
  ListAgentOAuthTokensInputSchema,
  type ListAgentOAuthTokensInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/agents/:id/oauth?namespace=…
 *
 * Returns sanitized (no access/refresh tokens) entries for every server
 * binding on this agent. Workspace gating via the wrapper.
 */
export const GET = createRouteAdapter<
  typeof ListAgentOAuthTokensInputSchema,
  ListAgentOAuthTokensInput,
  unknown,
  RouteContext
>(
  ListAgentOAuthTokensInputSchema,
  async (req, ctx) => ({
    id: (await ctx.params).id,
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
  }),
  listAgentOAuthTokens,
);
