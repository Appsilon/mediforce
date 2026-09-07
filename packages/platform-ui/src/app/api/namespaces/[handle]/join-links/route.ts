import { createRouteAdapter } from '@/lib/route-adapter';
import {
  CreateJoinLinkInputSchema,
  ListJoinLinksInputSchema,
} from '@mediforce/platform-api/contract';
import { createJoinLink, listJoinLinks } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

/** GET — every join link of the workspace, newest first. Owner/admin only. */
export const GET = createRouteAdapter<
  typeof ListJoinLinksInputSchema,
  { namespaceHandle: string },
  unknown,
  RouteContext
>(
  ListJoinLinksInputSchema,
  async (_req, ctx) => ({ namespaceHandle: (await ctx.params).handle }),
  listJoinLinks,
);

/**
 * POST — mint a join link (ADR-0021). The response carries the plaintext token
 * exactly once; only its hash is stored.
 */
export const POST = createRouteAdapter<
  typeof CreateJoinLinkInputSchema,
  ReturnType<typeof CreateJoinLinkInputSchema.parse>,
  unknown,
  RouteContext
>(
  CreateJoinLinkInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, namespaceHandle: (await ctx.params).handle };
  },
  createJoinLink,
  { successStatus: 201 },
);
