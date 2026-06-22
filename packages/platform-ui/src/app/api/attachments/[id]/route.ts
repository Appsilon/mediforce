import { createRouteAdapter } from '@/lib/route-adapter';
import { deleteAttachment } from '@mediforce/platform-api/handlers';
import {
  DeleteAttachmentInputSchema,
  type DeleteAttachmentInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/attachments/:id
 *
 * Soft-deletes one attachment (flags the metadata row, keeps the blob — blob
 * GC is a later sweep, ADR-0003 §7). Workspace gating lives in the handler;
 * out-of-scope ids surface as 404.
 */
export const DELETE = createRouteAdapter<
  typeof DeleteAttachmentInputSchema,
  DeleteAttachmentInput,
  unknown,
  RouteContext
>(
  DeleteAttachmentInputSchema,
  async (_req, ctx) => ({ attachmentId: (await ctx.params).id }),
  deleteAttachment,
);
