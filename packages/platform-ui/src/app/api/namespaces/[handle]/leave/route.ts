import { createRouteAdapter } from '@/lib/route-adapter';
import { LeaveNamespaceInputSchema } from '@mediforce/platform-api/contract';
import type { LeaveNamespaceInput } from '@mediforce/platform-api/contract';
import { leaveNamespace } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

export const POST = createRouteAdapter<typeof LeaveNamespaceInputSchema, LeaveNamespaceInput, unknown, RouteContext>(
  LeaveNamespaceInputSchema,
  async (_req, ctx) => ({ handle: (await ctx.params).handle }),
  leaveNamespace,
);
