import { NextResponse } from 'next/server';
import { PreviewJoinLinkInputSchema } from '@mediforce/platform-api/contract';
import { previewJoinLink } from '@mediforce/platform-api/handlers';
import { HandlerError } from '@mediforce/platform-api/errors';
import { jsonErrorResponse } from '@/lib/route-adapter';
import { publicJoinScope } from '@/lib/join-link-scope';
import { consumePreviewBudget, requireJsonRequest } from '../shared';

/**
 * POST — what workspace does this token open, and what does it grant?
 *
 * Public: the token is the authorization. Read-only — opening `/join/<token>`
 * must not spend a seat of a capped link, so nothing here consumes a use.
 *
 * The token travels in the body rather than the path so it stays out of this
 * endpoint's access logs. The page URL that carries it is unavoidable; there is
 * no reason to copy it into a second log line per render.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const guard = requireJsonRequest(request);
  if (guard !== null) return guard;

  const body: unknown = await request.json().catch(() => ({}));
  const parsed = PreviewJoinLinkInputSchema.safeParse(body);
  // A malformed body is answered as an unusable token, not as a distinct
  // validation error: there is no token to describe, which is what
  // `not_found` means.
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'not_found' });
  }

  // Charged after parsing, same as redeem: a malformed body should not burn an
  // honest attendee's budget.
  const limited = consumePreviewBudget(request);
  if (limited !== null) return limited;

  try {
    return NextResponse.json(await previewJoinLink(parsed.data, publicJoinScope()));
  } catch (err) {
    if (err instanceof HandlerError) return jsonErrorResponse(err);
    console.error('[join/preview] Failed to resolve join link:', err);
    return jsonErrorResponse(new HandlerError('internal', 'Internal error'));
  }
}
