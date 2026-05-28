import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  UpdateOAuthProviderInputApi,
  UpdateOAuthProviderOutput,
} from '../../contract/oauth-providers.js';
import { actorFromCaller } from '../_helpers.js';
import { toPublicProvider } from './_helpers.js';

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
  });

  return { provider: toPublicProvider(updated) };
}
