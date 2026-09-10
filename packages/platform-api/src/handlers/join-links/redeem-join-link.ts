import type { CallerScope } from '../../repositories/index';
import { JOIN_LINK_MEMBERSHIP } from '../../contract/join-links';
import type { RedeemJoinLinkInput, RedeemJoinLinkOutput } from '../../contract/join-links';
import { hashJoinToken } from '../../services/join-link';
import { seedMemberAndNotify } from '../users/seed-member';
import { requireJoinLinkService } from './_shared';

/**
 * Redeem a join link (ADR-0021 §4 — the load-bearing decision).
 *
 * **The token is the authorization; `scope.caller` is deliberately unused.**
 * This handler runs behind a public route, so it must never consult the caller.
 *
 * Redeeming seeds an account; it does NOT open a session. The token authorizes
 * *joining the workspace*; the emailed activation link — the same one
 * `inviteUser` sends, through the same `seedMemberAndNotify` — authorizes *the
 * session*. A link on a slide, or a photograph of that slide, is therefore
 * never itself a credential, and everyone who ends up in the workspace has a
 * mailbox they demonstrably control. The cost is one email round-trip, which
 * is the cost the invite path already pays.
 *
 * Two disclosure rules pull in opposite directions and both are deliberate:
 *
 *   - The TOKEN's failure is named plainly (`expired`, `revoked`, `exhausted`,
 *     `not_found`) — the holder has the secret, so this leaks nothing.
 *   - The EMAIL's outcome is not. An address that is already a member and one
 *     that is not produce the identical body, so `/join` cannot be turned into
 *     an enumeration oracle for a workspace's roster. `seedInvite` is
 *     idempotent on email collision, so "already a member" is a no-op write
 *     rather than a branch.
 *
 * The seat is consumed BEFORE the account is seeded. A crash between the two
 * costs one seat of a capped link; the reverse order would let a failure loop
 * seed unbounded memberships from a link that was supposed to admit ten people.
 */
export async function redeemJoinLink(
  input: RedeemJoinLinkInput,
  scope: CallerScope,
): Promise<RedeemJoinLinkOutput> {
  const service = requireJoinLinkService(scope);

  const now = new Date();
  const claim = await service.claim(hashJoinToken(input.token), now);
  if (!claim.ok) return { ok: false, reason: claim.reason };

  const link = claim.link;
  const email = input.email.trim().toLowerCase();
  const displayName =
    typeof input.displayName === 'string' && input.displayName.trim() !== ''
      ? input.displayName.trim()
      : undefined;

  const { uid, isExisting, emailSent, workspaceName } = await seedMemberAndNotify(
    {
      email,
      ...(displayName !== undefined ? { displayName } : {}),
      namespaceHandle: link.workspace,
      // Always the plain `member` seat (ADR-0021 §3) — never read off the
      // link, because there is nothing on it to read.
      membership: JOIN_LINK_MEMBERSHIP,
      // The email is whatever the form was given, by someone holding a shared
      // secret and nothing else. The seed may therefore only CREATE: it must
      // not rewrite an existing seat (a `member` link would otherwise demote
      // the workspace owner), stamp `invited_at` on an account the domain
      // allowlist deliberately blocks, or undo a removal.
      vouchedByAdmin: false,
      // No inviter to name — `seedMemberAndNotify` falls back to the
      // workspace's display name, so the email reads "<workspace> invited you".
    },
    scope,
  );

  await scope.system.audit.append({
    // The actor is the public route, NOT the account the email resolved to.
    // Nobody authenticated here: the form takes whatever address the holder
    // typed, so recording `uid` as the actor would let a holder who types the
    // owner's address produce an audit event claiming the owner did this. The
    // resolved account is the redemption's OUTPUT, and that is where it stays.
    actorId: 'join-link',
    actorType: 'system',
    actorRole: 'system',
    action: 'invitation.link_redeemed',
    description: `Join link '${link.id}' redeemed by '${email}' in namespace '${link.workspace}'`,
    timestamp: now.toISOString(),
    // The link id, never the token — an audit reader must not be able to
    // redeem what they are auditing.
    inputSnapshot: { joinLinkId: link.id, namespaceHandle: link.workspace, email },
    outputSnapshot: { uid, isExisting, emailSent, uses: link.uses },
    basis: 'Join link redeemed',
    entityType: 'invitation',
    entityId: link.id,
    namespace: link.workspace,
  });

  return { ok: true, namespaceHandle: link.workspace, workspaceName, emailSent };
}
