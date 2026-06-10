import { NextRequest, NextResponse } from 'next/server';
import { WorkspaceReader, OUTPUT_FILES_REPO_ROOT } from '@mediforce/agent-runtime';
import { NotFoundError, ValidationError, type HandlerError } from '@mediforce/platform-api/errors';
import { defaultBuildScope, defaultResolveCaller } from '@/lib/route-adapter';
import { attachmentContentDisposition, contentTypeForFilePath } from '@/lib/file-content-type';

interface RouteContext {
  params: Promise<{ runId: string; path: string[] }>;
}

const OUTPUT_FILES_PATH_PREFIX = `${OUTPUT_FILES_REPO_ROOT}/`;

/**
 * GET /api/runs/<runId>/files/<...path>
 *
 * Serves one Output File's bytes from the run branch of the workflow's bare
 * repo. Deliberately NOT on `createRouteAdapter` — the response is binary,
 * not the JSON envelope — but the auth + scope pipeline is byte-identical:
 * `defaultResolveCaller` / `defaultBuildScope` are the adapter's own
 * defaults, exported for exactly this route.
 *
 * `<...path>` is the repo-relative download key from
 * `GET /api/runs/<runId>/files` (`.mediforce/output/<stepId>/<name>`).
 * Paths outside `.mediforce/output/` or containing `..` segments are
 * rejected with 400 before any git invocation (defense in depth — the
 * `WorkspaceReader` enforces the same boundary).
 *
 * Workspace gating lives in `scope.runs.getById` — out-of-scope runs surface
 * as 404 (anti-enumeration), same as the JSON routes.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const callerOrResponse = await defaultResolveCaller(req);
  if (callerOrResponse instanceof NextResponse) return callerOrResponse;
  const scope = defaultBuildScope(callerOrResponse);

  const { runId, path: pathSegments } = await ctx.params;
  const repoRelativePath = pathSegments.join('/');

  const hasTraversalSegment = repoRelativePath.split('/').includes('..');
  const isUnderOutputRoot =
    repoRelativePath.startsWith(OUTPUT_FILES_PATH_PREFIX) &&
    repoRelativePath.length > OUTPUT_FILES_PATH_PREFIX.length;
  if (hasTraversalSegment === true || isUnderOutputRoot === false) {
    return errorResponse(
      new ValidationError(
        `Output File paths must live under ${OUTPUT_FILES_PATH_PREFIX} and contain no ".." segments`,
      ),
    );
  }

  const run = await scope.runs.getById(runId);
  if (run === null) {
    return errorResponse(new NotFoundError(`Run ${runId} not found`));
  }

  const fileBytes = await new WorkspaceReader().readOutputFile(
    { name: run.definitionName, namespace: run.namespace },
    runId,
    repoRelativePath,
  );
  if (fileBytes === null) {
    return errorResponse(new NotFoundError(`Output File ${repoRelativePath} not found for run ${runId}`));
  }

  const fileName = repoRelativePath.split('/').pop() ?? 'download';
  return new NextResponse(new Uint8Array(fileBytes), {
    headers: {
      'Content-Type': contentTypeForFilePath(fileName),
      'Content-Disposition': attachmentContentDisposition(fileName),
      'Content-Length': String(fileBytes.byteLength),
    },
  });
}

function errorResponse(err: HandlerError): NextResponse {
  return NextResponse.json(err.toEnvelope(), { status: err.statusCode });
}
