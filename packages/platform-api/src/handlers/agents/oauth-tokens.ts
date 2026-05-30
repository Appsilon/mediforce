import { PublicAgentOAuthTokenSchema, type AgentOAuthToken } from '@mediforce/platform-core';
import type {
  ListAgentOAuthTokensInput,
  ListAgentOAuthTokensOutput,
  GetAgentOAuthTokenInput,
  GetAgentOAuthTokenOutput,
  DeleteAgentOAuthTokenInput,
  DeleteAgentOAuthTokenOutput,
} from '../../contract/agents';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import { actorFromCaller } from '../_helpers';

function sanitize(
  entry: AgentOAuthToken & { serverName: string },
) {
  const { serverName, accessToken: _omitAccess, refreshToken: _omitRefresh, ...rest } = entry;
  const publicSlice = PublicAgentOAuthTokenSchema.parse(rest);
  return { ...publicSlice, serverName };
}

export async function listAgentOAuthTokens(
  input: ListAgentOAuthTokensInput,
  scope: CallerScope,
): Promise<ListAgentOAuthTokensOutput> {
  const entries = await scope.agentOAuthTokens.listByAgent(input.namespace, input.id);
  return { tokens: entries.map(sanitize) };
}

export async function getAgentOAuthToken(
  input: GetAgentOAuthTokenInput,
  scope: CallerScope,
): Promise<GetAgentOAuthTokenOutput> {
  const token = await scope.agentOAuthTokens.get(input.namespace, input.id, input.serverName);
  if (token === null) throw new NotFoundError('Token not found');
  return { token: sanitize({ ...token, serverName: input.serverName }) };
}

async function revokeAtProvider(revokeUrl: string, accessToken: string): Promise<void> {
  const body = new URLSearchParams({ token: accessToken });
  try {
    await fetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch {
    // Fire-and-forget: local delete always proceeds even on network failure.
  }
}

export async function deleteAgentOAuthToken(
  input: DeleteAgentOAuthTokenInput,
  scope: CallerScope,
): Promise<DeleteAgentOAuthTokenOutput> {
  if (input.revokeAtProvider === true) {
    const [token, provider] = await Promise.all([
      scope.agentOAuthTokens.get(input.namespace, input.id, input.serverName),
      scope.oauthProviders.get(input.namespace, input.provider),
    ]);
    if (token !== null && provider?.revokeUrl !== undefined) {
      await revokeAtProvider(provider.revokeUrl, token.accessToken);
    }
  }

  await scope.agentOAuthTokens.delete(input.namespace, input.id, input.serverName);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'agent.oauth_token_revoked',
    description: `OAuth token for agent '${input.id}' / server '${input.serverName}' revoked`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      agentId: input.id,
      namespace: input.namespace,
      serverName: input.serverName,
      provider: input.provider,
      revokeAtProvider: input.revokeAtProvider ?? false,
    },
    outputSnapshot: {},
    basis: 'OAuth token revoked via API',
    entityType: 'agentDefinition',
    entityId: input.id,
    namespace: input.namespace,
  });
  return { success: true };
}
