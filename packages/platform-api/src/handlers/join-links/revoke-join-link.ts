import { assertCallerIsNamespaceAdmin } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { RevokeJoinLinkInput, RevokeJoinLinkOutput } from '../../contract/join-links';
import { actorFromCaller } from '../_helpers';
import { requireJoinLinkService, toJoinLinkView } from './_shared';

/**
 * Close a join link (ADR-0021, Consequences).
 *
 * Revoking does NOT remove anyone: people who already joined stay members, and
 * removing them is `namespace remove-member`, as it is for any other member. A
 * link is an entrance, not a tenancy.
 *
 * A link that is already revoked 404s rather than reporting success — the
 * store's revoke only matches live rows, so "nothing to revoke" and "no such
 * link in this workspace" are one answer, which is also the right answer for a
 * caller probing another workspace's link ids.
 */
export async function revokeJoinLink(
  input: RevokeJoinLinkInput,
  scope: CallerScope,
): Promise<RevokeJoinLinkOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);
  const service = requireJoinLinkService(scope);

  const now = new Date();
  const link = await service.revoke(input.namespaceHandle, input.id, now);
  if (link === null) {
    throw new NotFoundError(`No live join link '${input.id}' in workspace '${input.namespaceHandle}'`);
  }

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'invitation.link_revoked',
    description: `Join link '${input.id}' revoked in namespace '${input.namespaceHandle}'`,
    timestamp: now.toISOString(),
    inputSnapshot: { namespaceHandle: input.namespaceHandle, id: input.id },
    outputSnapshot: { id: link.id, uses: link.uses, revokedAt: link.revokedAt },
    basis: 'Join link revoked via API',
    entityType: 'invitation',
    entityId: link.id,
    namespace: input.namespaceHandle,
  });

  return { link: toJoinLinkView(link, now) };
}
