import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentDefinitionRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createAgent } from '../create-agent';
import { updateAgent } from '../update-agent';
import { listAgentVersions } from '../list-agent-versions';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { NotFoundError } from '../../../errors';

const AGENT = {
  kind: 'plugin' as const,
  runtimeId: 'claude-code-agent',
  name: 'AE grader',
  iconName: 'Bot',
  description: 'Grades adverse events',
  foundationModel: 'anthropic/claude-sonnet-4',
  systemPrompt: 'You grade adverse events by CTCAE v5.',
  inputDescription: 'Extracted AEs',
  outputDescription: 'Graded AEs',
  namespace: 'team-alpha',
  visibility: 'private' as const,
};

describe('listAgentVersions handler (ADR-0029)', () => {
  let agentDefinitionRepo: InMemoryAgentDefinitionRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
    auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
  });

  const scope = (namespaces = ['team-alpha']) => createTestScope({ agentDefinitionRepo, auditRepo, caller: userCaller('u-1', namespaces) });

  it('records a version when an agent is created, and a new one only when what shapes its behaviour changes', async () => {
    const { agent } = await createAgent(AGENT, scope());
    expect(await listAgentVersions({ id: agent.id }, scope())).toMatchObject({ versions: [{ version: 1, createdBy: 'u-1' }], current: 1 });

    await updateAgent({ id: agent.id, body: { name: 'Renamed grader', description: 'Still grades' } }, scope());
    expect((await listAgentVersions({ id: agent.id }, scope())).versions).toHaveLength(1);

    await updateAgent({ id: agent.id, body: { systemPrompt: 'You grade adverse events by CTCAE v6.' } }, scope());
    const { versions, current } = await listAgentVersions({ id: agent.id }, scope());
    expect(current).toBe(2);
    expect(versions.map((version) => [version.version, version.config.systemPrompt])).toEqual([
      [2, 'You grade adverse events by CTCAE v6.'],
      [1, 'You grade adverse events by CTCAE v5.'],
    ]);
    expect(versions[0]!.hash).not.toBe(versions[1]!.hash);
  });

  it('reports no current version when the agent changed without a save that recorded one', async () => {
    const { agent } = await createAgent(AGENT, scope());
    await agentDefinitionRepo.update(agent.id, { foundationModel: 'anthropic/claude-opus-4' });
    expect(await listAgentVersions({ id: agent.id }, scope())).toMatchObject({ versions: [{ version: 1 }], current: null });
  });

  it('reads another workspace\'s private agent as missing', async () => {
    const { agent } = await createAgent(AGENT, scope());
    await expect(listAgentVersions({ id: agent.id }, scope(['pharma-b']))).rejects.toBeInstanceOf(NotFoundError);
  });
});
