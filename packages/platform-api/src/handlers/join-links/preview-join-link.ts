import type { CallerScope } from '../../repositories/index';
import type { PreviewJoinLinkInput, PreviewJoinLinkOutput } from '../../contract/join-links';
import { hashJoinToken } from '../../services/join-link';
import { requireJoinLinkService } from './_shared';

/**
 * What `/join/<token>` shows before anyone types an email.
 *
 * **The token is the authorization; `scope.caller` is deliberately unused.**
 * This handler runs behind a public route, so it must never consult the caller
 * — there isn't one. Everything it discloses is already implied by possession
 * of the secret: which workspace the link opens, and what membership it grants.
 *
 * Non-throwing: an expired, revoked, exhausted or unknown token is a `reason`,
 * not an error. The holder possesses the secret, so naming the reason leaks
 * nothing and is exactly what they need in order to ask for a new link. That
 * is the opposite of the stance `redeemJoinLink` takes on the EMAIL.
 *
 * Consumes nothing — opening the page must not spend a seat of a capped link.
 */
export async function previewJoinLink(
  input: PreviewJoinLinkInput,
  scope: CallerScope,
): Promise<PreviewJoinLinkOutput> {
  const service = requireJoinLinkService(scope);

  const lookup = await service.find(hashJoinToken(input.token), new Date());
  if (!lookup.ok) return { ok: false, reason: lookup.reason };

  const namespace = await scope.workspaces.getNamespace(lookup.link.workspace);
  return {
    ok: true,
    namespaceHandle: lookup.link.workspace,
    workspaceName: namespace?.displayName ?? lookup.link.workspace,
    membership: lookup.link.membership,
  };
}
