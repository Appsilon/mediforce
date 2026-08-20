import { createRouteAdapter } from '@/lib/route-adapter';
import { recordTaskViewed } from '@mediforce/platform-api/handlers';
import { RecordTaskViewedInputSchema } from '@mediforce/platform-api/contract';
import type { RecordTaskViewedInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/tasks/:taskId/viewed
 *
 * Records that the calling user opened the task view. No state change on
 * the task — pure instrumentation for Monitoring → Tasks' `task.viewed`
 * audit trail. Caller-kind gate (user only) lives in the handler.
 */
export const POST = createRouteAdapter<
  typeof RecordTaskViewedInputSchema,
  RecordTaskViewedInput,
  unknown,
  RouteContext
>(
  RecordTaskViewedInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  recordTaskViewed,
);
