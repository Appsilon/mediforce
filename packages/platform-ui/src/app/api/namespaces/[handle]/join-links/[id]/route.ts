import { createRouteAdapter } from '@/lib/route-adapter';
import { RevokeJoinLinkInputSchema } from '@mediforce/platform-api/contract';
import type { RevokeJoinLinkInput } from '@mediforce/platform-api/contract';
import { revokeJoinLink } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string; id: string }>;
}

/**
 * DELETE — close the link. Nobody who already joined is removed; that stays
 * `DELETE /api/namespaces/:handle/members/:uid`. A link is an entrance, not a
 * tenancy.
 */
export const DELETE = createRouteAdapter<
  typeof RevokeJoinLinkInputSchema,
  RevokeJoinLinkInput,
  unknown,
  RouteContext
>(
  RevokeJoinLinkInputSchema,
  async (_req, ctx) => {
    const { handle, id } = await ctx.params;
    return { namespaceHandle: handle, id };
  },
  revokeJoinLink,
);
