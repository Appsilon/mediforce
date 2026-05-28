import { assertCallerIsNamespaceOwner } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  DeleteNamespaceInput,
  DeleteNamespaceOutput,
} from '../../contract/namespaces.js';

/**
 * DELETE /api/namespaces/:handle — cascade delete. Owner only.
 *
 * Deletes every member doc + arrayRemoves the handle from each member's
 * `users/{uid}.organizations`, then deletes the namespace doc itself.
 * Atomicity: Firestore batch (cap ~249 members per workspace; see
 * `NamespaceRepository.deleteNamespaceCascade` docstring).
 *
 * Emits `namespace.deleted` per ADR-0005 §7.
 */
export async function deleteNamespace(
  input: DeleteNamespaceInput,
  scope: CallerScope,
): Promise<DeleteNamespaceOutput> {
  assertCallerIsNamespaceOwner(scope.caller, input.handle);

  const existing = await scope.workspaces.getNamespace(input.handle);
  if (existing === null) {
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  await scope.workspaces.deleteNamespaceCascade(input.handle);

  const now = new Date().toISOString();
  await scope.system.audit.append({
    actorId: scope.caller.kind === 'user' ? scope.caller.uid : 'system',
    actorType: scope.caller.kind === 'user' ? 'user' : 'system',
    actorRole: scope.caller.kind === 'user' ? 'operator' : 'system',
    action: 'namespace.deleted',
    description: `Namespace '${input.handle}' deleted (cascade)`,
    timestamp: now,
    inputSnapshot: { handle: input.handle },
    outputSnapshot: { handle: input.handle },
    basis: 'Owner deleted workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
  });

  return { handle: input.handle };
}
