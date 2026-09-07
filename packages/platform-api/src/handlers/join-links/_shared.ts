import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { JoinLinkView } from '../../contract/join-links';
import type { JoinLink, JoinLinkService } from '../../services/join-link';
import { joinLinkStatus } from '../../services/join-link';

/**
 * The join-link store, or a clear precondition failure. Same contract as
 * `inviteService`: a deployment that is not wired for invites says so rather
 * than 500ing.
 */
export function requireJoinLinkService(scope: CallerScope): JoinLinkService {
  const service = scope.system.joinLinkService;
  if (service === null) {
    throw new PreconditionFailedError('Join links are not configured');
  }
  return service;
}

/**
 * Wire shape for a link. `workspace` becomes `namespaceHandle` to match every
 * other contract, and `status` is derived once here so the settings list, the
 * CLI table and the `/join` page cannot disagree about what "expired" means.
 *
 * `tokenHash` is deliberately absent: nothing outside the store ever needs it,
 * and a view that carried it would put a redeemable secret's hash into every
 * list response.
 */
export function toJoinLinkView(link: JoinLink, now: Date): JoinLinkView {
  return {
    id: link.id,
    namespaceHandle: link.workspace,
    membership: link.membership,
    expiresAt: link.expiresAt,
    maxUses: link.maxUses,
    uses: link.uses,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
    status: joinLinkStatus(link, now),
  };
}
