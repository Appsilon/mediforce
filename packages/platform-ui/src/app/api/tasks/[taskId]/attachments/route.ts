import { NextRequest, NextResponse } from 'next/server';
import { listAttachments, uploadAttachment } from '@mediforce/platform-api/handlers';
import {
  ListAttachmentsInputSchema,
  type ListAttachmentsInput,
  type UploadAttachmentInput,
} from '@mediforce/platform-api/contract';
import { ValidationError } from '@mediforce/platform-api/errors';
import {
  createMultipartRouteAdapter,
  createRouteAdapter,
  type RouteAdapterOptions,
} from '@/lib/route-adapter';

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
export function makeGET(
  options: Pick<RouteAdapterOptions, 'resolveCaller' | 'buildScope'> = {},
): (req: NextRequest, ctx: RouteContext) => Promise<NextResponse> {
  return createRouteAdapter<
    typeof ListAttachmentsInputSchema,
    ListAttachmentsInput,
    unknown,
    RouteContext
  >(
    ListAttachmentsInputSchema,
    async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
    listAttachments,
    options,
  );
}

export const GET = makeGET();

/**
 * POST /api/tasks/:taskId/attachments
 *
 * Uploads one file to a Human Task. Size enforcement
 * (`MEDIFORCE_ATTACHMENT_MAX_BYTES`) and workspace gating live in the handler;
 * the route only turns the multipart form into the handler's
 * `UploadAttachmentInput`.
 */
export function makePOST(
  options: Pick<RouteAdapterOptions, 'resolveCaller' | 'buildScope'> = {},
): (req: NextRequest, ctx: RouteContext) => Promise<NextResponse> {
  return createMultipartRouteAdapter<UploadAttachmentInput, unknown, RouteContext>(
    async (form, _req, ctx) => {
      const { taskId } = await ctx.params;
      const file = form.get('file');
      if (file instanceof File === false) {
        throw new ValidationError('file field is required');
      }
      return {
        taskId,
        name: file.name,
        contentType: file.type.length > 0 ? file.type : 'application/octet-stream',
        content: Buffer.from(await file.arrayBuffer()),
      };
    },
    uploadAttachment,
    {
      ...options,
      successStatus: 201,
      logTag: 'task-attachment-upload-route',
      unreadableBodyMessage: 'Could not read the uploaded file. It may exceed the maximum upload size.',
    },
  );
}

export const POST = makePOST();
