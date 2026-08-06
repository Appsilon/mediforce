import { createRouteAdapter } from '@/lib/route-adapter';
import { ResetNamespaceInputSchema } from '@mediforce/platform-api/contract';
import type { ResetNamespaceInput } from '@mediforce/platform-api/contract';
import { resetNamespace } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

export const POST = createRouteAdapter<typeof ResetNamespaceInputSchema, ResetNamespaceInput, unknown, RouteContext>(
  ResetNamespaceInputSchema,
  async (_req, ctx) => ({ handle: (await ctx.params).handle }),
  resetNamespace,
);
