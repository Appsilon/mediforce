import { createRouteAdapter } from '@/lib/route-adapter';
import { SetNamespaceMemberRolesInputSchema } from '@mediforce/platform-api/contract';
import type { SetNamespaceMemberRolesInput } from '@mediforce/platform-api/contract';
import { setNamespaceMemberRoles } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string; uid: string }>;
}

/**
 * PUT — replace the member's process-domain roles (ADR-0019). Sibling of
 * `PATCH ../` (singular `role`), which flips Membership; these are different
 * things that both live on a member.
 *
 * PUT rather than PATCH because the body is the member's full end state, not
 * a diff.
 */
export const PUT = createRouteAdapter<typeof SetNamespaceMemberRolesInputSchema, SetNamespaceMemberRolesInput, unknown, RouteContext>(
  SetNamespaceMemberRolesInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { handle, uid } = await ctx.params;
    return { ...body, handle, uid };
  },
  setNamespaceMemberRoles,
);
