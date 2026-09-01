import {
  MemberNotInNamespaceError,
  WORKFLOW_MANAGER_ROLE,
  formatRoleGrant,
} from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin } from '../../auth';
import { emitAudit } from '../../audit-helpers';
import { NotFoundError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  SetNamespaceMemberRolesInput,
  SetNamespaceMemberRolesOutput,
} from '../../contract/namespaces';

/**
 * Owner/admin replaces a member's process-domain roles in one workspace
 * (ADR-0019, issue #1248) — `reviewer`, `PI`, `approver`: what someone *does*
 * in a process, as opposed to the Membership role (`owner`/`admin`/`member`)
 * that `updateNamespaceMemberRole` flips.
 *
 * Full replace, so the caller states the end state rather than a diff: two
 * concurrent edits cannot interleave into a set neither asked for, and an
 * empty `grants` clears the member's roles.
 *
 * The target must already be a member. Roles compose with Membership by AND
 * (ADR-0019), so a grant to a non-member authorises nothing — but it would
 * survive, invisible, and silently take effect if that person were ever added.
 * That is the same failure the removal cascade exists to prevent, so the
 * grant path refuses to create it.
 *
 * That check is not made here. A `getMember` call before the write is a
 * check the storage layer can invalidate before it runs: a removal committing
 * in between recreates exactly the grant the removal cascade just deleted.
 * `setRolesForUser` therefore checks membership under the same lock it does
 * the replace under, and this handler only translates the refusal — one
 * check, at the only place it can be atomic.
 *
 * Roles stay free-form strings: the vocabulary is open by construction, so an
 * unknown role is not a validation error here.
 *
 * One grant survives the replace: **the workspace's owner always holds
 * `workflow-manager`** (ADR-0020). Every workflow created here is gated by a
 * list naming it, so a replace that dropped it would leave the workspace with
 * no one able to reach a workflow somebody else made — and, since the owner is
 * the one seat that cannot be removed or demoted, no one able to grant it
 * back. Seeding it once at creation is not enough for an invariant a full
 * replace can clear in a click, which is exactly how a demo workspace lost it.
 */
export async function setNamespaceMemberRoles(
  input: SetNamespaceMemberRolesInput,
  scope: CallerScope,
): Promise<SetNamespaceMemberRolesOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.handle);

  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) throw new NotFoundError(`Namespace "${input.handle}" not found`);

  const directory = scope.system.userDirectory;
  if (directory === null) {
    throw new PreconditionFailedError(
      'No user directory is wired on this deployment, so process roles cannot be granted.',
      { handle: input.handle, uid: input.uid },
    );
  }

  const grants = await withOwnersManagerRole(input.uid, input.handle, input.grants, scope);

  const previous = await directory.getRolesForUser(input.uid, input.handle);
  try {
    await directory.setRolesForUser(input.uid, input.handle, grants);
  } catch (error) {
    if (error instanceof MemberNotInNamespaceError) throw new NotFoundError(error.message);
    throw error;
  }

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'namespace.member_roles_updated',
    description: `Process roles for '${input.uid}' in '${input.handle}' set to [${describe(grants)}]`,
    inputSnapshot: { handle: input.handle, uid: input.uid, grants: input.grants },
    outputSnapshot: { handle: input.handle, uid: input.uid, previousRoles: previous },
    basis: 'Owner/admin set member process roles via API',
    entityType: 'namespace',
    entityId: input.handle,
    namespace: input.handle,
  });

  return { handle: input.handle, uid: input.uid, grants };
}

/**
 * The grants as written, plus the workspace-wide `workflow-manager` an owner
 * keeps whatever the request said.
 *
 * Added rather than refused: the Roles table renders the owner's chip without
 * a remove control, so a request to drop it is a client that has not caught up
 * — or the CLI — and a 400 would be a worse answer than the state the screen
 * already shows. Anyone else's grants are replaced exactly as asked.
 *
 * A membership read that loses a race here costs at most one redundant grant,
 * never a lost one: `setRolesForUser` re-checks membership under its own lock.
 */
async function withOwnersManagerRole(
  uid: string,
  handle: string,
  grants: SetNamespaceMemberRolesInput['grants'],
  scope: CallerScope,
): Promise<SetNamespaceMemberRolesInput['grants']> {
  const member = await scope.workspaces.getMember(handle, uid);
  if (member?.role !== 'owner') return grants;

  const alreadyHeld = grants.some(
    (grant) => grant.role === WORKFLOW_MANAGER_ROLE && grant.workflowName === null,
  );
  if (alreadyHeld) return grants;

  return [...grants, { role: WORKFLOW_MANAGER_ROLE, workflowName: null }];
}

function describe(grants: SetNamespaceMemberRolesInput['grants']): string {
  if (grants.length === 0) return 'none';
  return grants.map(formatRoleGrant).join(', ');
}
