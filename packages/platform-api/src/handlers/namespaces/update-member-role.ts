import { assertCallerIsNamespaceOwner } from '../../auth.js';
import { NotFoundError, PreconditionFailedError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  UpdateNamespaceMemberRoleInput,
  UpdateNamespaceMemberRoleOutput,
} from '../../contract/namespaces.js';

/**
 * PATCH /api/namespaces/:handle/members/:uid — flip member ↔ admin role.
 * Owner only (`assertCallerIsNamespaceOwner`). Returns the post-mutation
 * member entity-echo per ADR-0005 §5. Emits `namespace.member_role_changed`
 * per ADR-0005 §7.
 *
 * Promoting / demoting the workspace owner through this endpoint is
 * rejected — there is no transfer-ownership flow yet, and silently flipping
 * the owner to admin would orphan the workspace.
 */
export async function updateNamespaceMemberRole(
  input: UpdateNamespaceMemberRoleInput,
  scope: CallerScope,
): Promise<UpdateNamespaceMemberRoleOutput> {
  assertCallerIsNamespaceOwner(scope.caller, input.handle);

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
      'Cannot change the workspace owner’s role through this endpoint.',
      { handle: input.handle, uid: input.uid, role: 'owner' },
    );
  }

  await scope.workspaces.setMemberRole(input.handle, input.uid, input.role);

  const updated = await scope.workspaces.getMember(input.handle, input.uid);
  if (updated === null) {
    throw new NotFoundError(`Member '${input.uid}' not in namespace '${input.handle}'`);
  }

  const now = new Date().toISOString();
  await scope.system.audit.append({
    actorId: scope.caller.kind === 'user' ? scope.caller.uid : 'system',
    actorType: scope.caller.kind === 'user' ? 'user' : 'system',
    actorRole: scope.caller.kind === 'user' ? 'operator' : 'system',
    action: 'namespace.member_role_changed',
    description: `Member '${input.uid}' role: '${member.role}' → '${input.role}' in '${input.handle}'`,
    timestamp: now,
    inputSnapshot: { handle: input.handle, uid: input.uid, role: input.role },
    outputSnapshot: { handle: input.handle, uid: input.uid, previousRole: member.role, role: updated.role },
    basis: 'Owner changed member role via API',
    entityType: 'namespace',
    entityId: input.handle,
  });

  return { member: updated };
}
