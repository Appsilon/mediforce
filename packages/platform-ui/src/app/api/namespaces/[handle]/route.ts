import { createRouteAdapter } from '@/lib/route-adapter';
import {
  DeleteNamespaceInputSchema,
  GetNamespaceInputSchema,
  UpdateNamespaceInputSchema,
} from '@mediforce/platform-api/contract';
import type {
  DeleteNamespaceInput,
  GetNamespaceInput,
  UpdateNamespaceInput,
} from '@mediforce/platform-api/contract';
import {
  deleteNamespace,
  getNamespace,
  updateNamespace,
} from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

export const GET = createRouteAdapter<typeof GetNamespaceInputSchema, GetNamespaceInput, unknown, RouteContext>(
  GetNamespaceInputSchema,
  async (_req, ctx) => ({ handle: (await ctx.params).handle }),
  getNamespace,
);

export const PATCH = createRouteAdapter<typeof UpdateNamespaceInputSchema, UpdateNamespaceInput, unknown, RouteContext>(
  UpdateNamespaceInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, handle: (await ctx.params).handle };
  },
  updateNamespace,
);

export const DELETE = createRouteAdapter<typeof DeleteNamespaceInputSchema, DeleteNamespaceInput, unknown, RouteContext>(
  DeleteNamespaceInputSchema,
  async (_req, ctx) => ({ handle: (await ctx.params).handle }),
  deleteNamespace,
);
