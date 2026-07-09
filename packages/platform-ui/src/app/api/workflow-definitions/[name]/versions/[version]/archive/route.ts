import { createRouteAdapter } from '@/lib/route-adapter';
import { archiveWorkflowVersion } from '@mediforce/platform-api/handlers';
import {
  ArchiveVersionInputSchema,
  type ArchiveVersionInput,
} from '@mediforce/platform-api/contract';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ name: string; version: string }>;
}

const ScopedSchema = ArchiveVersionInputSchema.extend({
  namespace: z.string().min(1),
});

export const POST = createRouteAdapter<
  typeof ScopedSchema,
  ArchiveVersionInput & { namespace: string },
  unknown,
  RouteContext
>(
  ScopedSchema,
  async (req, ctx) => {
    const { name, version: versionStr } = await ctx.params;
    const version = Number(versionStr);
    const namespace = req.nextUrl.searchParams.get('namespace');
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, name, version, namespace: namespace ?? undefined };
  },
  archiveWorkflowVersion,
);
