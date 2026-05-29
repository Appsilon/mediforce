import { assertCallerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteOAuthProviderInput,
  DeleteOAuthProviderOutput,
} from '../../contract/oauth-providers';
import { actorFromCaller } from '../_helpers';

export async function deleteOAuthProvider(
  input: DeleteOAuthProviderInput,
  scope: CallerScope,
): Promise<DeleteOAuthProviderOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);

  const existed = await scope.oauthProviders.delete(input.namespace, input.id);

  // Emit audit only on actual deletion. Idempotent no-op (existed === false)
  // matches the legacy route's "always 200" behavior at the wire level but
  // avoids noisy audit entries for nothing-happened calls.
  if (existed) {
    const actor = actorFromCaller(scope);
    await scope.system.audit.append({
      ...actor,
      action: 'oauth_provider.deleted',
      description: `OAuth provider '${input.id}' deleted from namespace '${input.namespace}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { namespace: input.namespace, id: input.id },
      outputSnapshot: { id: input.id },
      basis: 'OAuth provider deleted via API',
      entityType: 'oauthProvider',
      entityId: input.id,
    });
  }

  return { success: true };
}
