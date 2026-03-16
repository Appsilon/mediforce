import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/platform-services';
import { resolveTask, isResolveError } from '@/lib/resolve-task';

/**
 * POST /api/tasks/:taskId/resolve
 *
 * Thin HTTP wrapper around resolveTask(). See resolve-task.ts for logic.
 *
 * Body shapes:
 * - Verdict:     { "verdict": "approve" | "revise", "comment": "..." }
 * - Params:      { "paramValues": { ... } }
 * - File upload: { "attachments": [{ name, size, type, storagePath, downloadUrl }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const body = (await req.json()) as Record<string, unknown>;

    const result = await resolveTask(taskId, body);

    if (isResolveError(result)) {
      return NextResponse.json(
        { error: result.error },
        { status: result.httpStatus },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
