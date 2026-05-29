import { createRouteAdapter } from '@/lib/route-adapter';
import {
  RemoveNamespaceMemberInputSchema,
  UpdateNamespaceMemberRoleInputSchema,
} from '@mediforce/platform-api/contract';
import type {
  RemoveNamespaceMemberInput,
  UpdateNamespaceMemberRoleInput,
} from '@mediforce/platform-api/contract';
import {
  removeNamespaceMember,
  updateNamespaceMemberRole,
} from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string; uid: string }>;
}

export const DELETE = createRouteAdapter<typeof RemoveNamespaceMemberInputSchema, RemoveNamespaceMemberInput, unknown, RouteContext>(
  RemoveNamespaceMemberInputSchema,
  async (_req, ctx) => {
    const { handle, uid } = await ctx.params;
    return { handle, uid };
  },
  removeNamespaceMember,
);

export const PATCH = createRouteAdapter<typeof UpdateNamespaceMemberRoleInputSchema, UpdateNamespaceMemberRoleInput, unknown, RouteContext>(
  UpdateNamespaceMemberRoleInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { handle, uid } = await ctx.params;
    return { ...body, handle, uid };
  },
  updateNamespaceMemberRole,
);
