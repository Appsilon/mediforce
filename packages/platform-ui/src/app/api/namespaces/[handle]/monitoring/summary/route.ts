import { createRouteAdapter } from '@/lib/route-adapter';
import { getMonitoringSummary } from '@mediforce/platform-api/handlers';
import { MonitoringSummaryInputSchema, type MonitoringSummaryInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

/**
 * GET /api/namespaces/:handle/monitoring/summary
 *
 * Compact dashboard aggregate (~200 B). The handler runs server-side counts —
 * never returns a list payload. Polls at 30 s from the UI per ADR-0006 §4
 * "NICE LIVE".
 */
export const GET = createRouteAdapter<
  typeof MonitoringSummaryInputSchema,
  MonitoringSummaryInput,
  unknown,
  RouteContext
>(MonitoringSummaryInputSchema, async (_req, ctx) => ({ handle: (await ctx.params).handle }), getMonitoringSummary);
