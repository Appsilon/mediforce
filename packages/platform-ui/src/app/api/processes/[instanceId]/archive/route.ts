import { createRouteAdapter } from '@/lib/route-adapter';
import { archiveRun } from '@mediforce/platform-api/handlers';
import { ArchiveRunInputSchema } from '@mediforce/platform-api/contract';
import type { ArchiveRunInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * POST /api/processes/:instanceId/archive
 *
 * Soft-archives or unarchives a run. Blocked on active runs
 * (running/created/waiting-for-human). Entity echo per ADR-0005 §5.
 */
export const POST = createRouteAdapter<typeof ArchiveRunInputSchema, ArchiveRunInput, unknown, RouteContext>(
  ArchiveRunInputSchema,
  async (req, ctx) => ({
    runId: (await ctx.params).instanceId,
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
  }),
  archiveRun,
);
