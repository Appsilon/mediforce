import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type { GetNamespaceInput, GetNamespaceOutput } from '../../contract/namespaces.js';

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
  return { namespace, members };
}
