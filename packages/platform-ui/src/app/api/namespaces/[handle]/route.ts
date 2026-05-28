import { createRouteAdapter } from '@/lib/route-adapter';
import { GetNamespaceInputSchema } from '@mediforce/platform-api/contract';
import type { GetNamespaceInput } from '@mediforce/platform-api/contract';
import { getNamespace } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

export const GET = createRouteAdapter<typeof GetNamespaceInputSchema, GetNamespaceInput, unknown, RouteContext>(
  GetNamespaceInputSchema,
  async (_req, ctx) => ({ handle: (await ctx.params).handle }),
  getNamespace,
);
