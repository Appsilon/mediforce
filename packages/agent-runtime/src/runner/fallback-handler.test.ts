import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackHandler } from './fallback-handler.js';
import {
  InMemoryProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { AgentContext } from '../interfaces/agent-plugin.js';
import type { StepConfig, AgentEvent, ProcessConfig } from '@mediforce/platform-core';
import { NoopLlmClient } from '../testing/index.js';

// --- Test helpers ---

function makeProcessConfig(): ProcessConfig {
  return {
    processName: 'test-process',
    configName: 'all-human',
    configVersion: '1',
    stepConfigs: [],
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'step-1',
    processInstanceId: 'instance-1',
    definitionVersion: '1.0.0',
    stepInput: {},
    autonomyLevel: 'L4',
    config: makeProcessConfig(),
    llm: new NoopLlmClient(),
    getPreviousStepOutputs: async () => ({}),
    ...overrides,
  };
}

function makeStepConfig(overrides: Partial<StepConfig> = {}): StepConfig {
  return {
    stepId: 'step-1',
    executorType: 'agent',
    ...overrides,
  };
}

function makeAgentEvent(type: string): AgentEvent {
  return {
    id: crypto.randomUUID(),
    processInstanceId: 'instance-1',
    stepId: 'step-1',
    sequence: 0,
    type,
    payload: { data: 'partial' },
    timestamp: new Date().toISOString(),
  };
}

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
  });
}

describe('FallbackHandler', () => {
  let instanceRepository: InMemoryProcessInstanceRepository;
  let handler: FallbackHandler;
  let context: AgentContext;

  beforeEach(async () => {
    instanceRepository = new InMemoryProcessInstanceRepository();
    handler = new FallbackHandler(instanceRepository);
    context = makeContext();
    await createTestInstance(instanceRepository);
  });

  // --- Test 1: escalate_to_human + timeout ---
  it('escalate_to_human with timeout: pauses instance with agent_escalated and returns escalated status', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });
    const partialWork: AgentEvent[] = [makeAgentEvent('status'), makeAgentEvent('annotation')];

    const result = await handler.handle('timeout', context, stepConfig, partialWork);

    // Instance should be paused with agent_escalated
    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('agent_escalated');

    // Result should reflect escalation
    expect(result.status).toBe('escalated');
    expect(result.envelope).toBeNull();
    expect(result.appliedToWorkflow).toBe(false);
    expect(result.fallbackReason).toBe('timeout');
  });

  // --- Test 2: escalate_to_human + low_confidence ---
  it('escalate_to_human with low_confidence: pauses instance and returns escalated status', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });

    const result = await handler.handle('low_confidence', context, stepConfig, []);

    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('agent_escalated');
    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('low_confidence');
  });

  // --- Test 3: escalate_to_human + error ---
  it('escalate_to_human with error: pauses instance and returns escalated status', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });

    const result = await handler.handle('error', context, stepConfig, []);

    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('agent_escalated');
    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('error');
  });

  // --- Test 4: continue_with_flag + timeout ---
  it('continue_with_flag with timeout: does NOT pause instance, returns flagged status', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'continue_with_flag' });

    const result = await handler.handle('timeout', context, stepConfig, []);

    // Instance should NOT be updated (workflow continues)
    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('running');
    expect(instance?.pauseReason).toBeNull();

    expect(result.status).toBe('flagged');
    expect(result.envelope).toBeNull();
    expect(result.appliedToWorkflow).toBe(false);
    expect(result.fallbackReason).toBe('timeout');
  });

  // --- Test 5: continue_with_flag + low_confidence ---
  it('continue_with_flag with low_confidence: workflow not paused, returns flagged', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'continue_with_flag' });

    const result = await handler.handle('low_confidence', context, stepConfig, []);

    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('running');
    expect(result.status).toBe('flagged');
    expect(result.fallbackReason).toBe('low_confidence');
  });

  // --- Test 6: pause + error ---
  it('pause with error: pauses instance with agent_paused and returns paused status', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'pause' });

    const result = await handler.handle('error', context, stepConfig, []);

    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('agent_paused');

    expect(result.status).toBe('paused');
    expect(result.envelope).toBeNull();
    expect(result.appliedToWorkflow).toBe(false);
    expect(result.fallbackReason).toBe('error');
  });

  // --- Test 7: default fallback (no fallbackBehavior configured) ---
  it('defaults to escalate_to_human when fallbackBehavior is not configured', async () => {
    const stepConfig = makeStepConfig(); // no fallbackBehavior

    const result = await handler.handle('timeout', context, stepConfig, []);

    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('agent_escalated');
    expect(result.status).toBe('escalated');
  });

  // --- Test 8: Partial work attached to escalation ---
  it('partial work events remain in event log after escalation (FallbackHandler does not clear them)', async () => {
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });
    const partialWork: AgentEvent[] = [makeAgentEvent('status'), makeAgentEvent('annotation')];

    const result = await handler.handle('timeout', context, stepConfig, partialWork);

    // Result has null envelope (no complete envelope)
    expect(result.envelope).toBeNull();
    // FallbackHandler does NOT have reference to eventLog, so it doesn't clear events
    // Partial work passed in is unchanged (2 events)
    expect(partialWork).toHaveLength(2);
  });
});
