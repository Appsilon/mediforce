import { NextRequest, NextResponse } from 'next/server';
import { WorkspaceReader } from '@mediforce/agent-runtime';
import { HandlerError, NotFoundError } from '@mediforce/platform-api/errors';
import { defaultBuildScope, defaultResolveCaller, jsonErrorResponse } from '@/lib/route-adapter';
import { attachmentContentDisposition } from '@/lib/file-content-type';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

/**
 * GET /api/runs/<runId>/files/archive
 *
 * Streams all Output Files for a run as a zip archive produced by
 * `git archive`. Auth pipeline mirrors the single-file download route.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const callerOrResponse = await defaultResolveCaller(req);
  if (callerOrResponse instanceof NextResponse) return callerOrResponse;
  const scope = defaultBuildScope(callerOrResponse);

  try {
    const { runId } = await ctx.params;

    const run = await scope.runs.getById(runId);
    if (run === null) {
      return jsonErrorResponse(new NotFoundError(`Run ${runId} not found`));
    }

    const archive = await new WorkspaceReader().archiveOutputFiles(
      { name: run.definitionName, namespace: run.namespace },
      runId,
    );
    if (archive === null) {
      return jsonErrorResponse(new NotFoundError(`No output files found for run ${runId}`));
    }

    const fileName = `${run.definitionName}-${runId.slice(0, 8)}-output.zip`;
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentContentDisposition(fileName),
        'Content-Length': String(archive.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof HandlerError) return jsonErrorResponse(err);
    console.error('[run-output-files-archive-route] handler error:', err);
    return jsonErrorResponse(new HandlerError('internal', 'Internal error'));
  }
}
