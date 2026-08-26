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
