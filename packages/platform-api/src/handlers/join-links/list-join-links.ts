import { assertCallerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type { ListJoinLinksInput, ListJoinLinksOutput } from '../../contract/join-links';
import { requireJoinLinkService, toJoinLinkView } from './_shared';

/**
 * Every join link of a workspace, newest first — revoked and expired included.
 *
 * Owner/admin only, the same gate that mints them: the list is how an admin
 * finds the link they need to revoke, and a spent or revoked link is exactly
 * the row that answers "did that workshop link ever get closed?". Tokens are
 * never returned; only the store holds their hashes.
 */
export async function listJoinLinks(
  input: ListJoinLinksInput,
  scope: CallerScope,
): Promise<ListJoinLinksOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);
  const service = requireJoinLinkService(scope);

  const now = new Date();
  const links = await service.listForWorkspace(input.namespaceHandle);
  return { links: links.map((link) => toJoinLinkView(link, now)) };
}
