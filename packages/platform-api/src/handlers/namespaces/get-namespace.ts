import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { GetNamespaceInput, GetNamespaceOutput } from '../../contract/namespaces';

/**
 * Return a workspace's metadata + member list. Anti-enum on access:
 * non-members get the same 404 as a missing handle so namespace existence
 * does not leak to outsiders. apiKey callers bypass.
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

  return { namespace, members, personalHandles };
}
