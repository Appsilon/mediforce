import { NextResponse } from 'next/server';
import { RedeemJoinLinkInputSchema } from '@mediforce/platform-api/contract';
import { redeemJoinLink } from '@mediforce/platform-api/handlers';
import { HandlerError } from '@mediforce/platform-api/errors';
import { jsonErrorResponse } from '@/lib/route-adapter';
import { publicJoinScope } from '@/lib/join-link-scope';
import { consumeRedeemBudget, requireJsonRequest } from '../shared';

/**
 * POST — redeem a join link (ADR-0021 §4).
 *
 * Public, and it sends mail, which is why the rate limit is in the same file
 * that shipped the route. Seeds the account and emails the ordinary activation
 * link; it never opens a session, so a leaked link cannot be replayed into
 * anybody's account.
 *
 * The token's own failures come back named (`expired`, `revoked`, …) — the
 * holder has the secret. The email's outcome never differs: an address that is
 * already a member and one that is not produce the identical body.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const guard = requireJsonRequest(request);
  if (guard !== null) return guard;

  const body: unknown = await request.json().catch(() => ({}));
  const parsed = RedeemJoinLinkInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonErrorResponse(
      new HandlerError('validation', parsed.error.issues[0]?.message ?? 'Invalid input'),
    );
  }

  // Budget is charged after parsing so a bad JSON body cannot burn an honest
  // attendee's attempts, but before the handler so a valid token cannot be
  // used to fan mail out.
  const limited = consumeRedeemBudget(request, parsed.data.token);
  if (limited !== null) return limited;

  try {
    return NextResponse.json(await redeemJoinLink(parsed.data, publicJoinScope()));
  } catch (err) {
    if (err instanceof HandlerError) return jsonErrorResponse(err);
    console.error('[join/redeem] Failed to redeem join link:', err);
    return jsonErrorResponse(new HandlerError('internal', 'Internal error'));
  }
}
