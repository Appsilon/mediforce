import { NextRequest, NextResponse } from 'next/server';
import { listAttachments, uploadAttachment } from '@mediforce/platform-api/handlers';
import {
  ListAttachmentsInputSchema,
  type ListAttachmentsInput,
} from '@mediforce/platform-api/contract';
import { HandlerError, ValidationError } from '@mediforce/platform-api/errors';
import { createRouteAdapter, defaultBuildScope, defaultResolveCaller } from '@/lib/route-adapter';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * GET /api/tasks/:taskId/attachments
 *
 * Lists the active attachments for a Human Task. Workspace gating lives in
 * `scope.attachments` — out-of-scope tasks surface as an empty list / 404,
 * same as the other task routes.
 */
export const GET = createRouteAdapter<
  typeof ListAttachmentsInputSchema,
  ListAttachmentsInput,
  unknown,
  RouteContext
>(
  ListAttachmentsInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  listAttachments,
);

/**
 * POST /api/tasks/:taskId/attachments
 *
 * Uploads one file to a Human Task. Deliberately NOT on `createRouteAdapter` —
 * the request body is `multipart/form-data`, not JSON — but the auth + scope
 * pipeline is byte-identical: `defaultResolveCaller` / `defaultBuildScope` are
 * the adapter's own defaults, exported for exactly this kind of route.
 *
 * Size enforcement (`MEDIFORCE_ATTACHMENT_MAX_BYTES`) and workspace gating
 * live in the handler; the route only turns the multipart form into the
 * handler's `UploadAttachmentInput`.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const callerOrResponse = await defaultResolveCaller(req);
  if (callerOrResponse instanceof NextResponse) return callerOrResponse;
  const scope = defaultBuildScope(callerOrResponse);

  // Same error tail as createRouteAdapter (src/lib/route-adapter.ts): a
  // HandlerError maps to the ADR-0005 envelope, anything else is logged and
  // becomes a 500 'internal' envelope — never Next's default 500 page.
  try {
    const { taskId } = await ctx.params;
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File === false) {
      throw new ValidationError('file field is required');
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await uploadAttachment(
      {
        taskId,
        name: file.name,
        contentType: file.type.length > 0 ? file.type : 'application/octet-stream',
        content,
      },
      scope,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof HandlerError) return errorResponse(err);
    console.error('[task-attachment-upload-route] handler error:', err);
    return errorResponse(new HandlerError('internal', 'Internal error'));
  }
}

function errorResponse(err: HandlerError): NextResponse {
  return NextResponse.json(err.toEnvelope(), { status: err.statusCode });
}
