import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { getAttachmentBlob } from '@mediforce/platform-api/handlers';
import { HandlerError } from '@mediforce/platform-api/errors';
import { defaultBuildScope, defaultResolveCaller } from '@/lib/route-adapter';
import { attachmentContentDisposition } from '@/lib/file-content-type';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/attachments/:id/blob
 *
 * Streams one attachment's bytes. Deliberately NOT on `createRouteAdapter` —
 * the response is binary, not the JSON envelope — but the auth + scope
 * pipeline is byte-identical: `defaultResolveCaller` / `defaultBuildScope` are
 * the adapter's own defaults, exported for exactly this route.
 *
 * Workspace gating, soft-delete, and missing-blob handling all live in the
 * handler and surface as 404 (anti-enumeration), same as the JSON routes.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const callerOrResponse = await defaultResolveCaller(req);
  if (callerOrResponse instanceof NextResponse) return callerOrResponse;
  const scope = defaultBuildScope(callerOrResponse);

  // Same error tail as createRouteAdapter (src/lib/route-adapter.ts): a
  // HandlerError maps to the ADR-0005 envelope, anything else is logged and
  // becomes a 500 'internal' envelope — never Next's default 500 page.
  try {
    const { id } = await ctx.params;
    const { attachment, stream } = await getAttachmentBlob({ attachmentId: id }, scope);

    // `Readable.toWeb` returns a `ReadableStream<Uint8Array>` whose generic
    // doesn't structurally match the DOM `ReadableStream` that NextResponse's
    // body type expects; cast narrowly to bridge the two stream typings.
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Length': String(attachment.sizeBytes),
        'Content-Disposition': attachmentContentDisposition(attachment.name),
      },
    });
  } catch (err) {
    if (err instanceof HandlerError) return errorResponse(err);
    console.error('[attachment-blob-route] handler error:', err);
    return errorResponse(new HandlerError('internal', 'Internal error'));
  }
}

function errorResponse(err: HandlerError): NextResponse {
  return NextResponse.json(err.toEnvelope(), { status: err.statusCode });
}
