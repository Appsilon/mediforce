import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackHandler } from './fallback-handler';
import { InMemoryProcessInstanceRepository } from '@mediforce/platform-core';

async function createTestInstance(instanceRepository: InMemoryProcessInstanceRepository) {
  await instanceRepository.create({
    id: 'instance-1',
    definitionName: 'test-process',
    definitionVersion: '1.0.0',
    configName: 'all-human',
    configVersion: '1',
    status: 'running',
    currentStepId: 'step-1',
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'user-1',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    archived: false,
    dryRun: false,
  });
}

describe('FallbackHandler', () => {
  let instanceRepository: InMemoryProcessInstanceRepository;
  let handler: FallbackHandler;

  beforeEach(async () => {
    instanceRepository = new InMemoryProcessInstanceRepository();
    handler = new FallbackHandler(instanceRepository);
    await createTestInstance(instanceRepository);
  });

  it.each(['timeout', 'error', 'output_schema', 'production_evaluator'] as const)(
    'escalates a %s fallback: pauses the instance with agent_escalated',
    async (reason) => {
      const result = await handler.escalate(reason, 'instance-1');

      const instance = await instanceRepository.getById('instance-1');
      expect(instance?.status).toBe('paused');
      expect(instance?.pauseReason).toBe('agent_escalated');
      expect(result).toEqual({ status: 'escalated', envelope: null, appliedToWorkflow: false, fallbackReason: reason });
    },
  );

  it('keeps the envelope the agent produced for the person who picks it up', async () => {
    const envelope = {
      confidence: 0.4, reasoning_summary: 'partial', reasoning_chain: [], annotations: [],
      result: { findings: [] }, model: 'anthropic/claude-sonnet-4', duration_ms: 1200,
    };

    const result = await handler.escalate('output_schema', 'instance-1', envelope);

    expect(result.envelope).toEqual(envelope);
  });
});
