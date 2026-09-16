import { createRouteAdapter } from '@/lib/route-adapter';
import { previewRepoFiles } from '@mediforce/platform-api/handlers';
import {
  PreviewRepoFilesInputSchema,
  type PreviewRepoFilesInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name/repo-files — read back the files a step
 * builds from at its pinned commit, for display only. Writes nothing.
 */
export const GET = createRouteAdapter<
  typeof PreviewRepoFilesInputSchema,
  PreviewRepoFilesInput,
  unknown,
  RouteContext
>(
  PreviewRepoFilesInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const params = req.nextUrl.searchParams;
    const input: Record<string, unknown> = { name, stepId: params.get('stepId') ?? '' };
    const namespace = params.get('namespace');
    if (namespace !== null) input.namespace = namespace;
    const version = params.get('version');
    if (version !== null) input.version = Number(version);
    return input;
  },
  previewRepoFiles,
);
