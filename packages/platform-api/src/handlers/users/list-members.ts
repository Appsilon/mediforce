import { callerIsNamespaceAdmin } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { RoleGrantInput } from '../../contract/namespaces';
import type {
  ListNamespaceMembersInput,
  ListNamespaceMembersOutput,
  NamespaceMemberWithAuth,
} from '../../contract/users';

/**
 * Return the workspace's member list with each member's `auth_users`
 * metadata (email + lastSignInTime) merged in. Read-only — every active
 * member (any role) may read; non-members get an anti-enum 404 rather than
 * a 403 so that namespace existence does not leak to outsiders.
 *
 * `email` (contact / PII) and `lastSignInTime` (activity) are manager fields,
 * gated to owner/admin (and apiKey) callers: a plain member receives `null`
 * for both on every row. The roster — name, avatar, membership, join date and
 * process role `grants` (ADR-0019) — stays visible to all members so
 * collaboration still works: a member has to be able to see who the reviewer
 * is.
 *
 * apiKey callers bypass the membership gate (server-to-server trust).
 *
 * When `scope.system.userDirectory` is `null` (no directory wired — only the
 * in-memory test scope hits this), each member is returned with
 * `email: null`, `lastSignInTime: null` and `grants: []`. The list itself
 * still resolves.
 *
 * A directory that IS wired but fails is not the same case: metadata degrades
 * to `null` per row, while a failed `getGrantsForUser` rejects the whole read
 * rather than reporting an empty grant list the editor would then overwrite.
 */
export async function listNamespaceMembers(
  input: ListNamespaceMembersInput,
  scope: CallerScope,
): Promise<ListNamespaceMembersOutput> {
  if (!scope.caller.isSystemActor) {
    if (!scope.caller.namespaces.has(input.namespace)) {
      throw new NotFoundError(`Namespace "${input.namespace}" not found`);
    }
  }

  const memberDocs = await scope.workspaces.getMembers(input.namespace);
  const directory = scope.system.userDirectory;
  const canSeeManagerFields = callerIsNamespaceAdmin(scope.caller, input.namespace);

  if (directory === null) {
    return {
      members: memberDocs.map((doc) => withAuth(doc, null, [], canSeeManagerFields)),
    };
  }

  const authData = await Promise.all(
    memberDocs.map((doc) => directory.getUserMetadata(doc.uid).catch(() => null)),
  );
  // No `.catch` here, unlike the metadata read above: `grants` is the read half
  // of `setMemberRoles`, which is a full replace. A failed read degraded to `[]`
  // would render as "holds no roles", and the next grant written from that row
  // would ship only the new one — silently revoking every grant the failure hid.
  // Missing contact details are cosmetic; a missing grant is destructive, so
  // this read fails the whole roster rather than answering it wrong.
  const grants = await Promise.all(
    memberDocs.map((doc) => directory.getGrantsForUser(doc.uid, input.namespace)),
  );

  return {
    members: memberDocs.map((doc, index) =>
      withAuth(doc, authData[index], grants[index] ?? [], canSeeManagerFields),
    ),
  };
}

function withAuth(
  doc: Awaited<ReturnType<CallerScope['workspaces']['getMembers']>>[number],
  metadata: { email: string | null; displayName?: string | null; lastSignInTime: string | null; photoURL?: string | null } | null,
  grants: readonly RoleGrantInput[],
  canSeeManagerFields: boolean,
): NamespaceMemberWithAuth {
  const docDisplayName = typeof doc.displayName === 'string' && doc.displayName.length > 0
    ? doc.displayName
    : null;
  return {
    ...doc,
    avatarUrl: doc.avatarUrl ?? metadata?.photoURL ?? undefined,
    displayName: docDisplayName ?? metadata?.displayName ?? null,
    email: canSeeManagerFields ? metadata?.email ?? null : null,
    lastSignInTime: canSeeManagerFields ? metadata?.lastSignInTime ?? null : null,
    grants: [...grants],
  };
}
