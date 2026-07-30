import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  GetNamespaceInput,
  GetNamespaceOutput,
  NamespaceAdminContact,
} from '../../contract/namespaces';

/**
 * Return a workspace's metadata + member list. Anti-enum on access:
 * non-members get the same 404 as a missing handle so namespace existence
 * does not leak to outsiders. apiKey callers bypass.
 *
 * `members` carries only the roster (no email / last-sign-in); those are
 * gated to admins in `listNamespaceMembers`. `adminContact` is the single
 * exception — the primary owner's name + email, surfaced to every member so a
 * blocked non-admin has someone to reach.
 */
export async function getNamespace(
  input: GetNamespaceInput,
  scope: CallerScope,
): Promise<GetNamespaceOutput> {
  const namespace = await scope.workspaces.getNamespace(input.handle);
  if (namespace === null) {
    throw new NotFoundError(`Namespace "${input.handle}" not found`);
  }

  if (!scope.caller.isSystemActor) {
    if (!scope.caller.namespaces.has(input.handle)) {
      throw new NotFoundError(`Namespace "${input.handle}" not found`);
    }
  }

  const members = await scope.workspaces.getMembers(input.handle);

  const settled = await Promise.allSettled(
    members.map(async (m) => {
      const namespaces = await scope.workspaces.getNamespacesByUser(m.uid);
      const personal = namespaces.find((ns) => ns.type === 'personal');
      return personal ? ([m.uid, personal.handle] as const) : null;
    }),
  );

  const personalHandles: Record<string, string> = {};
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      const [uid, handle] = result.value;
      personalHandles[uid] = handle;
    }
  }

  const adminContact = await resolveAdminContact(members, scope);

  return { namespace, members, personalHandles, adminContact };
}

/**
 * The earliest-joined `owner` is the workspace's primary contact. Returns
 * `null` when there is no owner or no directory is wired; falls back to the
 * member doc's displayName when the directory lookup yields none.
 */
async function resolveAdminContact(
  members: Awaited<ReturnType<CallerScope['workspaces']['getMembers']>>,
  scope: CallerScope,
): Promise<NamespaceAdminContact | null> {
  const owner = members
    .filter((m) => m.role === 'owner')
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
  if (owner === undefined) return null;

  const docDisplayName =
    typeof owner.displayName === 'string' && owner.displayName.length > 0
      ? owner.displayName
      : null;

  const directory = scope.system.userDirectory;
  if (directory === null) {
    return { displayName: docDisplayName, email: null };
  }

  const metadata = await directory.getUserMetadata(owner.uid).catch(() => null);
  return {
    displayName: docDisplayName ?? metadata?.displayName ?? null,
    email: metadata?.email ?? null,
  };
}
