import type { NamespaceUpdates } from '@mediforce/platform-core';
import {
  assertCallerIsNamespaceAdmin,
  assertCallerIsNamespaceOwner,
} from '../../auth';
import { emitAudit } from '../../audit-helpers';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { resolvePersonalNamespace } from '../_helpers';
import type {
  DeleteNamespaceInput,
  DeleteNamespaceOutput,
  LeaveNamespaceInput,
  LeaveNamespaceOutput,
  RemoveNamespaceMemberInput,
  RemoveNamespaceMemberOutput,
  UpdateNamespaceInput,
  UpdateNamespaceMemberRoleInput,
  UpdateNamespaceMemberRoleOutput,
  UpdateNamespaceOutput,
} from '../../contract/namespaces';

const BRANDING_FIELDS = ['icon', 'logo', 'brandPrimaryColor', 'brandAccentColor'] as const;

/**
 * Edit workspace `displayName`, `bio`, `icon`, `logo`, and brand colors.
 * Owner/admin only. Two-state semantics: undefined leaves the field untouched,
 * any string overwrites it (empty string is the cleared state for `bio`, `logo`,
 * and the brand colors — cleared branding falls back to the icon + default
 * palette). Branding is organization-only: a personal namespace renders the
 * linked user's avatar, so icon/logo/colors have nowhere to show.
 */
export async function updateNamespace(
  input: UpdateNamespaceInput,
  scope: CallerScope,
): Promise<UpdateNamespaceOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.handle);

  const existing = await scope.workspaces.getNamespace(input.handle);
  if (existing === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

  if (existing.type === 'personal') {
    const attempted = BRANDING_FIELDS.filter((field) => input[field] !== undefined);
    if (attempted.length > 0) {
      throw new PreconditionFailedError(
        `Branding (${attempted.join(', ')}) can only be set on an organization workspace.`,
        { handle: input.handle, type: existing.type, fields: attempted },
      );
    }
  }

  const updates: NamespaceUpdates = {
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.logo !== undefined ? { logo: input.logo } : {}),
    ...(input.brandPrimaryColor !== undefined ? { brandPrimaryColor: input.brandPrimaryColor } : {}),
    ...(input.brandAccentColor !== undefined ? { brandAccentColor: input.brandAccentColor } : {}),
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
  };

  await scope.workspaces.updateNamespace(input.handle, updates);

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

  // The logo is a multi-KB base64 data URL; record only whether it was set or
  // cleared so the audit snapshot stays small.
  const { logo, ...auditableUpdates } = updates;
  const logoSnapshot = logo === undefined ? {} : { logo: logo === '' ? 'cleared' : 'updated' };

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'namespace.updated',
    description: `Namespace '${input.handle}' updated`,
    inputSnapshot: { handle: input.handle, ...auditableUpdates, ...logoSnapshot },
    outputSnapshot: { handle: namespace.handle, displayName: namespace.displayName },
    basis: 'Owner/admin edited workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: input.handle,
  });

  return { namespace };
}

/** Owner-only cascade delete via `NamespaceRepository.deleteNamespaceCascade`. */
export async function deleteNamespace(
  input: DeleteNamespaceInput,
  scope: CallerScope,
): Promise<DeleteNamespaceOutput> {
  assertCallerIsNamespaceOwner(scope.caller, input.handle);

  const existing = await scope.workspaces.getNamespace(input.handle);
  if (existing === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

  // `audit_events.workspace` is NOT NULL with an FK to `workspaces.handle`
  // *and* `ON DELETE CASCADE` (ADR-0001). So the deletion event needs a
  // workspace that (a) exists at insert time and (b) ideally survives this
  // cascade. For a user owner, their personal namespace satisfies both — the
  // deletion stays auditable after the workspace is gone. apiKey callers (CLI)
  // have no personal namespace; fall back to `input.handle` so the delete
  // still succeeds (FK-valid before the cascade) — the row then cascades away
  // with the workspace, which is the inherent CASCADE behaviour, not a 500.
  let auditNamespace = input.handle;
  if (scope.caller.kind === 'user') {
    const personal = await resolvePersonalNamespace(scope, scope.caller.uid);
    if (personal !== null) auditNamespace = personal;
  }

  // Emit before the cascade so the audit row's workspace FK resolves while
  // `auditNamespace` still exists; the cascade below removes `input.handle`.
  await emitAudit(scope.system.audit, scope.caller, {
    action: 'namespace.deleted',
    description: `Namespace '${input.handle}' deleted (cascade)`,
    inputSnapshot: { handle: input.handle },
    outputSnapshot: { handle: input.handle },
    basis: 'Owner deleted workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: auditNamespace,
  });

  await scope.workspaces.deleteNamespaceCascade(input.handle);

  return { handle: input.handle };
}

/**
 * Caller removes self from a workspace. Owner is blocked — no
 * ownership-transfer flow yet; delete the workspace instead. The owner
 * guard also catches personal namespaces (linked user is always owner).
 */
export async function leaveNamespace(
  input: LeaveNamespaceInput,
  scope: CallerScope,
): Promise<LeaveNamespaceOutput> {
  if (scope.caller.kind !== 'user') {
    throw new ForbiddenError(
      'POST /api/namespaces/:handle/leave requires an authenticated user (no "self" for apiKey callers)',
    );
  }
  const uid = scope.caller.uid;

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

  const member = await scope.workspaces.getMember(input.handle, uid);
  if (member === null) {
    // Anti-enum 404: do not leak "namespace exists, you are not a member".
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  if (member.role === 'owner') {
    throw new PreconditionFailedError(
      'Workspace owner cannot leave their own workspace. Delete the workspace instead, or have ownership transferred first.',
      { handle: input.handle, role: 'owner' },
    );
  }

  await scope.workspaces.removeMemberWithOrganizations(input.handle, uid);

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'namespace.member_left',
    description: `User '${uid}' left namespace '${input.handle}'`,
    inputSnapshot: { handle: input.handle, uid },
    outputSnapshot: { handle: input.handle, uid, removedRole: member.role },
    basis: 'User left workspace via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: input.handle,
  });

  return { handle: input.handle };
}

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
  if (namespace === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

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

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'namespace.member_removed',
    description: `Removed user '${input.uid}' from namespace '${input.handle}'`,
    inputSnapshot: { handle: input.handle, uid: input.uid },
    outputSnapshot: { handle: input.handle, uid: input.uid, removedRole: member.role },
    basis: 'Owner/admin removed member via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: input.handle,
  });

  return { handle: input.handle, uid: input.uid };
}

/**
 * Owner flips a member between `admin` and `member`. Changing the owner's
 * own role is rejected — no transfer-ownership flow yet.
 */
export async function updateNamespaceMemberRole(
  input: UpdateNamespaceMemberRoleInput,
  scope: CallerScope,
): Promise<UpdateNamespaceMemberRoleOutput> {
  assertCallerIsNamespaceOwner(scope.caller, input.handle);

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

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

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'namespace.member_role_changed',
    description: `Member '${input.uid}' role: '${member.role}' → '${input.role}' in '${input.handle}'`,
    inputSnapshot: { handle: input.handle, uid: input.uid, role: input.role },
    outputSnapshot: { handle: input.handle, uid: input.uid, previousRole: member.role, role: updated.role },
    basis: 'Owner changed member role via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: input.handle,
  });

  return { member: updated };
}
