import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { NotFoundError, PreconditionFailedError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  RemoveNamespaceMemberInput,
  RemoveNamespaceMemberOutput,
} from '../../contract/namespaces.js';

/**
 * Owner/admin removes a member. Removing the workspace owner is blocked —
 * delete the workspace or transfer ownership first.
 */
export async function removeNamespaceMember(
  input: RemoveNamespaceMemberInput,
  scope: CallerScope,
): Promise<RemoveNamespaceMemberOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.handle);

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) {
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  const member = await scope.workspaces.getMember(input.handle, input.uid);
  if (member === null) {
    throw new NotFoundError(`Member '${input.uid}' not in namespace '${input.handle}'`);
  }

  if (member.role === 'owner') {
    throw new PreconditionFailedError(
      'Cannot remove the workspace owner. Delete the workspace or transfer ownership first.',
      { handle: input.handle, uid: input.uid, role: 'owner' },
    );
  }

  await scope.workspaces.removeMemberWithOrganizations(input.handle, input.uid);

  const now = new Date().toISOString();
  await scope.system.audit.append({
    actorId: scope.caller.kind === 'user' ? scope.caller.uid : 'system',
    actorType: scope.caller.kind === 'user' ? 'user' : 'system',
    actorRole: scope.caller.kind === 'user' ? 'operator' : 'system',
    action: 'namespace.member_removed',
    description: `Removed user '${input.uid}' from namespace '${input.handle}'`,
    timestamp: now,
    inputSnapshot: { handle: input.handle, uid: input.uid },
    outputSnapshot: { handle: input.handle, uid: input.uid, removedRole: member.role },
    basis: 'Owner/admin removed member via API',
    entityType: 'namespace',
    entityId: input.handle,
  });

  return { handle: input.handle, uid: input.uid };
}
