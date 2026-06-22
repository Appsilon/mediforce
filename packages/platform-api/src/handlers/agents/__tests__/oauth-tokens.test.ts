import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentOAuthTokenRepository,
  InMemoryAuditRepository,
  InMemoryOAuthProviderRepository,
  InMemoryProcessInstanceRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { AgentOAuthToken } from '@mediforce/platform-core';
import { listAgentOAuthTokens, getAgentOAuthToken, deleteAgentOAuthToken } from '../oauth-tokens';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { NotFoundError } from '../../../errors';

const sampleToken: AgentOAuthToken = {
  provider: 'github',
  accessToken: 'gho_secret',
  scope: 'repo',
  providerUserId: '1',
  accountLogin: '@octocat',
  connectedAt: 1_700_000_000_000,
  connectedBy: 'u-1',
};

describe('agent OAuth token handlers', () => {
  let agentOAuthTokenRepo: InMemoryAgentOAuthTokenRepository;
  let oauthProviderRepo: InMemoryOAuthProviderRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    agentOAuthTokenRepo = new InMemoryAgentOAuthTokenRepository();
    oauthProviderRepo = new InMemoryOAuthProviderRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      agentOAuthTokenRepo,
      oauthProviderRepo,
      auditRepo,
      caller: userCaller('u-1', namespaces),
    });
  }

  it('listAgentOAuthTokens returns sanitized tokens for the agent', async () => {
    await agentOAuthTokenRepo.put('team-alpha', 'agent-1', 'github', sampleToken);
    const scope = buildScope();

    const { tokens } = await listAgentOAuthTokens({ id: 'agent-1', namespace: 'team-alpha' }, scope);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].serverName).toBe('github');
    expect((tokens[0] as { accessToken?: string }).accessToken).toBeUndefined();
  });

  it('getAgentOAuthToken throws NotFoundError when missing', async () => {
    const scope = buildScope();
    const err = await getAgentOAuthToken(
      { id: 'agent-1', namespace: 'team-alpha', serverName: 'github', provider: 'github' },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('deleteAgentOAuthToken removes the token and emits audit', async () => {
    await agentOAuthTokenRepo.put('team-alpha', 'agent-1', 'github', sampleToken);
    const scope = buildScope();

    const result = await deleteAgentOAuthToken(
      {
        id: 'agent-1',
        provider: 'github',
        namespace: 'team-alpha',
        serverName: 'github',
      },
      scope,
    );

    expect(result).toEqual({ success: true });
    const remaining = await agentOAuthTokenRepo.listByAgent('team-alpha', 'agent-1');
    expect(remaining).toHaveLength(0);
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('agent.oauth_token_revoked');
  });
});
