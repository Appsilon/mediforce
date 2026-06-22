import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createAgent } from '../create-agent';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('createAgent handler', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      agentDefinitionRepo,
      auditRepo,
      caller: userCaller('u-1', namespaces),
    });
  }

  it('createAgent stores the agent + emits audit', async () => {
    const scope = buildScope();
    const { agent } = await createAgent(
      {
        kind: 'plugin',
        name: 'Bob',
        iconName: 'Bot',
        description: 'd',
        foundationModel: 'm',
        systemPrompt: 'p',
        inputDescription: 'in',
        outputDescription: 'out',
        namespace: 'team-alpha',
        visibility: 'private',
      },
      scope,
    );
    expect(agent.name).toBe('Bob');
  });
});
