export interface DirectoryUser {
  uid: string;
  email: string;
  displayName?: string;
}

export interface UserAuthMetadata {
  email: string | null;
  displayName: string | null;
  lastSignInTime: string | null;
  photoURL: string | null;
}

/**
 * One process-domain role grant (ADR-0019). `workflowName: null` — the default
 * — means every workflow in the workspace; a value narrows the grant to that
 * one workflow.
 */
export interface RoleGrant {
  readonly role: string;
  readonly workflowName: string | null;
}

/**
 * `role` for a workspace-wide grant, `role@workflow` for a narrowed one — the
 * notation the audit trail and the CLI roster both write. Shared so the two
 * cannot drift: a reader diffing `set-member-roles`' audit entry against
 * `list-members` has to be reading the same string.
 */
export function formatRoleGrant(grant: RoleGrant): string {
  return grant.workflowName === null ? grant.role : `${grant.role}@${grant.workflowName}`;
}

export interface UserDirectoryService {
  /**
   * Holders of `role` in `namespace` who may act on `workflowName`: grants
   * scoped to that workflow plus workspace-wide ones (`workflowName: null`).
   *
   * Every consumer must pass the workflow it is acting on. Resolving a role
   * without one would email a holder scoped to workflow A about runs of
   * workflow B — enforcement narrowed while notifications leak (ADR-0019).
   */
  getUsersByRoleInNamespace(
    role: string,
    namespace: string,
    workflowName: string,
  ): Promise<DirectoryUser[]>;
  /**
   * Roles `uid` holds in `namespace`. Without `workflowName`, every role the
   * user holds anywhere in the workspace; with one, the roles that resolve for
   * that workflow (workspace-wide grants included). De-duplicated.
   */
  getRolesForUser(uid: string, namespace: string, workflowName?: string): Promise<string[]>;
  /**
   * `uid`'s grants in `namespace`, each keeping the workflow it is narrowed to.
   *
   * `getRolesForUser` above flattens to role names, which is what a gate wants
   * — it already knows the workflow it is asking about. An editor does not: it
   * has to render `reviewer` and `reviewer` narrowed to `tealflow` as different
   * chips, and `setRolesForUser` is a full replace, so writing back a flattened
   * read would silently widen every narrowed grant the member holds.
   */
  getGrantsForUser(uid: string, namespace: string): Promise<RoleGrant[]>;
  /**
   * Replace `uid`'s grants in `namespace` wholesale. Idempotent; an empty
   * `grants` clears them. Full replace rather than add/remove so the caller
   * states the end state.
   *
   * Two guarantees the caller cannot provide for itself, so they live here:
   *
   * - **Serialized per `(uid, namespace)`.** Full replace only means "the set
   *   the caller asked for" if replaces do not interleave. Two admins editing
   *   the same member concurrently would otherwise both delete the set they
   *   each read and then insert their own, leaving the union — a set neither
   *   of them requested, holding roles neither of them granted.
   * - **The target must be a member**, checked under the same lock. Roles
   *   compose with Membership by AND (ADR-0019), so a grant to a non-member
   *   authorises nothing — but it survives invisibly and silently takes
   *   effect if that person is ever re-added. A caller's own pre-check cannot
   *   close this: a removal committing between the check and the write
   *   recreates exactly the grant the removal cascade just deleted.
   *
   * Throws `MemberNotInNamespaceError` when `uid` is not a member.
   */
  setRolesForUser(uid: string, namespace: string, grants: readonly RoleGrant[]): Promise<void>;
  /**
   * Add one grant, leaving every other grant `uid` holds in `namespace`
   * untouched. Idempotent — granting a role already held changes nothing.
   *
   * The additive sibling of `setRolesForUser`, and not expressible in terms of
   * it: read-modify-write through a full replace re-opens exactly the
   * interleaving that method's lock exists to close, and it would resurrect
   * grants a concurrent removal had just cascaded away. Membership is checked
   * under the same lock, for the same reason.
   *
   * Its callers grant on behalf of the platform rather than of an admin —
   * `workflow-manager` to a workspace's owner and to whoever registers a
   * workflow (ADR-0020) — where the alternative is a default gate nobody can
   * pass.
   *
   * Throws `MemberNotInNamespaceError` when `uid` is not a member.
   */
  grantRole(uid: string, namespace: string, grant: RoleGrant): Promise<void>;
  /**
   * Drop every grant narrowed to `workflowName` in `namespace`. Called on the
   * two events that free the name — the workflow being deleted, and it being
   * transferred out to another workspace: a grant that outlives its workflow
   * is invisible until the name is reused, at which point it silently
   * reactivates (ADR-0019). Workspace-wide grants are untouched.
   */
  clearRolesForWorkflow(namespace: string, workflowName: string): Promise<void>;
  /** Every role held in `namespace`, de-duplicated — the workspace's role vocabulary. */
  getRolesInNamespace(namespace: string): Promise<string[]>;
  resolveUser?(identifier: string): Promise<DirectoryUser | null>;
  getUserMetadata(uid: string): Promise<UserAuthMetadata | null>;
}
