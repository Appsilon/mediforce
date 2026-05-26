import { createRouteAdapter } from '@/lib/route-adapter';
import { resumeRun } from '@mediforce/platform-api/handlers';
import { ResumeRunInputSchema } from '@mediforce/platform-api/contract';
import type { ResumeRunInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * POST /api/processes/:instanceId/resume
 *
 * State transition paused | failed → running. Source `failed` covers the
 * agent-escalated recovery flow. Audit emission via handler bridge per
 * ADR-0005 §7; the auto-runner kick fires after the state flip.
 */
export const POST = createRouteAdapter<
  typeof ResumeRunInputSchema,
  ResumeRunInput,
  unknown,
  RouteContext
>(
  ResumeRunInputSchema,
  async (_req, ctx) => ({ runId: (await ctx.params).instanceId }),
  resumeRun,
);
