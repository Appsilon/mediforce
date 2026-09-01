import type {
  UserDirectoryService,
  DirectoryUser,
  RoleGrant,
  UserAuthMetadata,
} from '../interfaces/user-directory-service';
import { MemberNotInNamespaceError } from '../errors';

export interface InMemoryDirectoryUser {
  readonly uid: string;
  readonly email: string;
  readonly displayName?: string | null;
  readonly image?: string | null;
}

interface StoredGrant {
  readonly uid: string;
  readonly namespace: string;
  readonly role: string;
  readonly workflowName: string | null;
}

/**
 * In-memory double for the workspace-scoped `user_roles` UserDirectoryService
 * (ADR-0019). Mirrors `PostgresUserDirectoryService`: role reads inner-join to
 * users (a grant for an unknown uid yields nothing), a `workflowName: null`
 * grant answers for every workflow in the workspace, and
 * `getUserMetadata.lastSignInTime` is always `null` (no sign-in record before
 * NextAuth sessions). The Postgres backend MUST satisfy the same contract —
 * `user-directory-parity.test.ts` runs both against it.
 *
 * `addRole` and `addMember` are the seeding backdoors, standing in for the
 * parity fixture's direct inserts. Only the product write paths —
 * `setRolesForUser` and `grantRole` — enforce membership, exactly as Postgres
 * does: the invariant lives on the write, not on the table.
 */
export class InMemoryUserDirectoryService implements UserDirectoryService {
  private readonly users = new Map<string, InMemoryDirectoryUser>();
  private readonly members = new Set<string>();
  private grants: StoredGrant[] = [];

  addUser(user: InMemoryDirectoryUser): void {
    this.users.set(user.uid, user);
  }

  /** Seed membership, so `setRolesForUser` has a member to grant to. */
  addMember(uid: string, namespace: string): void {
    this.members.add(memberKey(uid, namespace));
  }

  addRole(uid: string, namespace: string, role: string, workflowName: string | null = null): void {
    const exists = this.grants.some(
      (grant) =>
        grant.uid === uid &&
        grant.namespace === namespace &&
        grant.role === role &&
        grant.workflowName === workflowName,
    );
    if (!exists) this.grants.push({ uid, namespace, role, workflowName });
  }

  async getUsersByRoleInNamespace(
    role: string,
    namespace: string,
    workflowName: string,
  ): Promise<DirectoryUser[]> {
    const uids = new Set(
      this.grants
        .filter(
          (grant) =>
            grant.role === role &&
            grant.namespace === namespace &&
            (grant.workflowName === null || grant.workflowName === workflowName),
        )
        .map((grant) => grant.uid),
    );
    return [...uids]
      .map((uid) => this.users.get(uid))
      .filter((user): user is InMemoryDirectoryUser => user !== undefined)
      .map(toDirectoryUser);
  }

  async getRolesForUser(uid: string, namespace: string, workflowName?: string): Promise<string[]> {
    return [
      ...new Set(
        this.grants
          .filter(
            (grant) =>
              grant.uid === uid &&
              grant.namespace === namespace &&
              (workflowName === undefined ||
                grant.workflowName === null ||
                grant.workflowName === workflowName),
          )
          .map((grant) => grant.role),
      ),
    ];
  }

  async getGrantsForUser(uid: string, namespace: string): Promise<RoleGrant[]> {
    return this.grants
      .filter((grant) => grant.uid === uid && grant.namespace === namespace)
      .map((grant) => ({ role: grant.role, workflowName: grant.workflowName }));
  }

  async setRolesForUser(
    uid: string,
    namespace: string,
    grants: readonly RoleGrant[],
  ): Promise<void> {
    if (!this.members.has(memberKey(uid, namespace))) {
      throw new MemberNotInNamespaceError(uid, namespace);
    }
    this.grants = this.grants.filter(
      (grant) => grant.uid !== uid || grant.namespace !== namespace,
    );
    for (const grant of grants) {
      this.addRole(uid, namespace, grant.role, grant.workflowName);
    }
  }

  async grantRole(uid: string, namespace: string, grant: RoleGrant): Promise<void> {
    if (!this.members.has(memberKey(uid, namespace))) {
      throw new MemberNotInNamespaceError(uid, namespace);
    }
    this.addRole(uid, namespace, grant.role, grant.workflowName);
  }

  async clearRolesForWorkflow(namespace: string, workflowName: string): Promise<void> {
    this.grants = this.grants.filter(
      (grant) => grant.namespace !== namespace || grant.workflowName !== workflowName,
    );
  }

  async getRolesInNamespace(namespace: string): Promise<string[]> {
    return [
      ...new Set(
        this.grants.filter((grant) => grant.namespace === namespace).map((grant) => grant.role),
      ),
    ];
  }

  async resolveUser(identifier: string): Promise<DirectoryUser | null> {
    const match = identifier.includes('@')
      ? [...this.users.values()].find((u) => u.email === identifier)
      : this.users.get(identifier);
    return match ? toDirectoryUser(match) : null;
  }

  async getUserMetadata(uid: string): Promise<UserAuthMetadata | null> {
    const user = this.users.get(uid);
    if (!user) return null;
    return {
      email: user.email !== '' ? user.email : null,
      displayName:
        typeof user.displayName === 'string' && user.displayName !== ''
          ? user.displayName
          : null,
      lastSignInTime: null,
      photoURL: user.image ?? null,
    };
  }
}

function memberKey(uid: string, namespace: string): string {
  return `${namespace}\u0000${uid}`;
}

function toDirectoryUser(user: InMemoryDirectoryUser): DirectoryUser {
  return {
    uid: user.uid,
    email: user.email,
    ...(typeof user.displayName === 'string' && user.displayName !== ''
      ? { displayName: user.displayName }
      : {}),
  };
}
