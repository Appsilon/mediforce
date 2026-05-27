import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { updateAgent } from '../update-agent.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { NotFoundError } from '../../../errors.js';

describe('updateAgent handler', () => {
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

  it('updateAgent gates via wrapper (404 for foreign workspace)', async () => {
    const created = await agentDefinitionRepo.create({
      kind: 'plugin',
      name: 'Foreign',
      iconName: 'Bot',
      description: 'd',
      foundationModel: 'm',
      systemPrompt: 'p',
      inputDescription: 'i',
      outputDescription: 'o',
      skillFileNames: [],
      namespace: 'team-beta',
      visibility: 'private',
    });
    const scope = buildScope(['team-alpha']);
    const err = await updateAgent(
      { id: created.id, body: { description: 'changed' } },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });
});
