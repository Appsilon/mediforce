import { assertCallerIsNamespaceAdmin } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { UpdateOAuthProviderInputApi, UpdateOAuthProviderOutput } from '../../contract/oauth-providers';
import { actorFromCaller } from '../_helpers';
import { toPublicProvider } from './_helpers';

export async function updateOAuthProvider(
  input: UpdateOAuthProviderInputApi,
  scope: CallerScope,
): Promise<UpdateOAuthProviderOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const { namespace, id, ...patch } = input;

  const updated = await scope.oauthProviders.update(namespace, id, patch);
  if (updated === null) {
    throw new NotFoundError(`OAuth provider '${id}' not found`);
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'oauth_provider.updated',
    description: `OAuth provider '${id}' updated in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id, patchKeys: Object.keys(patch) },
    outputSnapshot: { id: updated.id, updatedAt: updated.updatedAt },
    basis: 'OAuth provider updated via API',
    entityType: 'oauthProvider',
    entityId: updated.id,
    namespace,
  });

  return { provider: toPublicProvider(updated) };
}
