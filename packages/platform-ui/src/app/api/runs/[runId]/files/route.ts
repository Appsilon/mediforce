import { createRouteAdapter } from '@/lib/route-adapter';
import { listRunOutputFiles } from '@mediforce/platform-api/handlers';
import {
  ListRunOutputFilesInputSchema,
  type ListRunOutputFilesInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

/**
 * GET /api/runs/<runId>/files
 *
 * Lists the run's Output Files — artifacts committed under
 * `.mediforce/output/<stepId>/` on the run branch of the workflow's bare
 * repo. Each entry's `path` is the download key for
 * `GET /api/runs/<runId>/files/<path>`.
 *
 * Workspace gating lives in `scope.runs.getById` — out-of-scope runs surface
 * as 404 (anti-enumeration). Runs without Output Files return `{ files: [] }`.
 */
export const GET = createRouteAdapter<
  typeof ListRunOutputFilesInputSchema,
  ListRunOutputFilesInput,
  unknown,
  RouteContext
>(
  ListRunOutputFilesInputSchema,
  async (_req, ctx) => ({ runId: (await ctx.params).runId }),
  listRunOutputFiles,
);
