import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { deleteAgent } from '../delete-agent.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { NotFoundError } from '../../../errors.js';

describe('deleteAgent handler', () => {
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

  it('deleteAgent throws NotFoundError when missing', async () => {
    const scope = buildScope();
    const err = await deleteAgent({ id: 'missing' }, scope).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('deleteAgent throws NotFoundError for a non-system member on a namespace-less public agent', async () => {
    const created = await agentDefinitionRepo.create({
      kind: 'plugin',
      name: 'Claude Code',
      iconName: 'Bot',
      description: 'd',
      foundationModel: 'm',
      systemPrompt: 'p',
      inputDescription: 'i',
      outputDescription: 'o',
      skillFileNames: [],
      namespace: undefined,
      visibility: 'public',
    });
    const scope = buildScope(['team-alpha']);
    const err = await deleteAgent({ id: created.id }, scope).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });
});
