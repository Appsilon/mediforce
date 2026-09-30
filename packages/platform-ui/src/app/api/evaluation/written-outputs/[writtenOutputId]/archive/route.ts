import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { archiveWrittenOutput } from '@mediforce/platform-api/handlers';
import { ArchiveWrittenOutputInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ writtenOutputId: string }>;
}

/** POST /api/evaluation/written-outputs/:writtenOutputId/archive — Archives (or restores) a written output. */
export const POST = createRouteAdapter<typeof ArchiveWrittenOutputInputSchema, z.infer<typeof ArchiveWrittenOutputInputSchema>, unknown, RouteContext>(
  ArchiveWrittenOutputInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    writtenOutputId: (await ctx.params).writtenOutputId,
  }),
  archiveWrittenOutput,
);
