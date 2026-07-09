import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  ListNamespaceMembersInput,
  ListNamespaceMembersOutput,
  NamespaceMemberWithAuth,
} from '../../contract/users';

/**
 * Return the workspace's member list with each member's Firebase Auth
 * metadata (email + lastSignInTime) merged in. Read-only — every active
 * member (any role) may read; non-members get an anti-enum 404 rather than
 * a 403 so that namespace existence does not leak to outsiders.
 *
 * apiKey callers bypass the membership gate (server-to-server trust).
 *
 * When `scope.system.userDirectory` is `null` (Firebase Auth not wired —
 * only the in-memory test scope hits this), each member is returned with
 * `email: null` and `lastSignInTime: null`. The list itself still resolves.
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

  if (directory === null) {
    return {
      members: memberDocs.map((doc) => withAuth(doc, null)),
    };
  }

  const authData = await Promise.all(
    memberDocs.map((doc) => directory.getUserMetadata(doc.uid).catch(() => null)),
  );

  return {
    members: memberDocs.map((doc, index) => withAuth(doc, authData[index])),
  };
}

function withAuth(
  doc: Awaited<ReturnType<CallerScope['workspaces']['getMembers']>>[number],
  metadata: { email: string | null; displayName?: string | null; lastSignInTime: string | null; photoURL?: string | null } | null,
): NamespaceMemberWithAuth {
  const docDisplayName = typeof doc.displayName === 'string' && doc.displayName.length > 0
    ? doc.displayName
    : null;
  return {
    ...doc,
    avatarUrl: doc.avatarUrl ?? metadata?.photoURL ?? undefined,
    displayName: docDisplayName ?? metadata?.displayName ?? null,
    email: metadata?.email ?? null,
    lastSignInTime: metadata?.lastSignInTime ?? null,
  };
}
