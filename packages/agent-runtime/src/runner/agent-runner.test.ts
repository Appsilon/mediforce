import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRunner } from './agent-runner.js';
import {
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import { InMemoryAgentEventLog } from '../testing/index.js';
import { NoopLlmClient } from '../testing/index.js';
import type {
  AgentPlugin,
  AgentContext,
  EmitFn,
} from '../interfaces/agent-plugin.js';
import type {
  StepConfig,
  ProcessConfig,
  AgentOutputEnvelope,
} from '@mediforce/platform-core';

// --- Test helpers ---

function makeProcessConfig(stepConfigs: StepConfig[] = []): ProcessConfig {
  return {
    processName: 'test-process',
    configName: 'all-human',
    configVersion: '1',
    stepConfigs,
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'step-1',
    processInstanceId: 'instance-1',
    definitionVersion: '1.0.0',
    stepInput: { patientId: 'P001' },
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
    plugin: 'test-plugin',
    model: 'anthropic/claude-sonnet-4',
    ...overrides,
  };
}

function makeValidEnvelope(overrides: Partial<AgentOutputEnvelope> = {}): AgentOutputEnvelope {
  return {
    confidence: 0.9,
    reasoning_summary: 'Analyzed patient data and found normal ranges.',
    reasoning_chain: ['Step 1: load data', 'Step 2: analyze', 'Step 3: conclude'],
    annotations: [],
    model: 'anthropic/claude-sonnet-4',
    duration_ms: 500,
    result: { recommendation: 'continue_monitoring' },
    ...overrides,
  };
}

/** Simple plugin that emits events synchronously then resolves */
function makeSuccessPlugin(envelope: AgentOutputEnvelope): AgentPlugin {
  return {
    initialize: async (_context: AgentContext) => {},
    run: async (emit: EmitFn) => {
      await emit({
        type: 'status',
        payload: { message: 'Starting analysis' },
        timestamp: new Date().toISOString(),
      });
      await emit({
        type: 'result',
        payload: envelope,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

/** Plugin that emits status events before a slow result (for timeout test) */
function makeSlowPlugin(delayMs: number, envelope: AgentOutputEnvelope): AgentPlugin {
  return {
    initialize: async (_context: AgentContext) => {},
    run: async (emit: EmitFn) => {
      await emit({
        type: 'status',
        payload: { message: 'Starting long analysis' },
        timestamp: new Date().toISOString(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      await emit({
        type: 'result',
        payload: envelope,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

/** Plugin that emits an invalid result payload */
function makeInvalidEnvelopePlugin(): AgentPlugin {
  return {
    initialize: async (_context: AgentContext) => {},
    run: async (emit: EmitFn) => {
      await emit({
        type: 'result',
        payload: { invalid: 'missing required fields' },
        timestamp: new Date().toISOString(),
      });
    },
  };
}

/** Plugin that emits multiple events before result */
function makeMultiEventPlugin(envelope: AgentOutputEnvelope): AgentPlugin {
  return {
    initialize: async (_context: AgentContext) => {},
    run: async (emit: EmitFn) => {
      await emit({ type: 'status', payload: { stage: 1 }, timestamp: new Date().toISOString() });
      await emit({ type: 'status', payload: { stage: 2 }, timestamp: new Date().toISOString() });
      await emit({
        type: 'annotation',
        payload: {
          id: crypto.randomUUID(),
          content: 'Relevant observation',
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });
      await emit({
        type: 'result',
        payload: envelope,
        timestamp: new Date().toISOString(),
      });
    },
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
    archived: false,
  });
}

describe('AgentRunner', () => {
  let instanceRepository: InMemoryProcessInstanceRepository;
  let auditRepository: InMemoryAuditRepository;
  let eventLog: InMemoryAgentEventLog;
  let runner: AgentRunner;

  beforeEach(async () => {
    instanceRepository = new InMemoryProcessInstanceRepository();
    auditRepository = new InMemoryAuditRepository();
    eventLog = new InMemoryAgentEventLog();
    runner = new AgentRunner(instanceRepository, auditRepository, eventLog);
    await createTestInstance(instanceRepository);
  });

  // --- Test 1: Successful L4 (Autopilot) run ---
  it('L4 Autopilot: completes run, applies to workflow, appends audit event', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig();

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(true);
    expect(result.envelope).toMatchObject({ confidence: 0.9 });
    expect(result.fallbackReason).toBeNull();

    // Audit event should be appended
    const audits = auditRepository.getAll();
    expect(audits).toHaveLength(1);
    expect(audits[0].actorType).toBe('agent');
  });

  // --- Test 2: L0 (Silent Observer) — output not surfaced ---
  it('L0 Silent Observer: completes run, output NOT applied to workflow', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L0' });
    const stepConfig = makeStepConfig();

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(false);
    expect(result.fallbackReason).toBeNull();

    // Audit event still appended
    expect(auditRepository.getAll()).toHaveLength(1);
  });

  // --- Test 3: L1 (Shadow) — result stored as shadow_result event ---
  it('L1 Shadow: result stored as shadow_result event in event log, not applied to workflow', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L1' });
    const stepConfig = makeStepConfig();

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(false);

    // Event log should contain a shadow_result event
    const events = eventLog.getEvents('instance-1', 'step-1');
    const shadowEvent = events.find((e) => e.type === 'shadow_result');
    expect(shadowEvent).toBeDefined();
  });

  // --- Test 4: L2 (Annotator) — annotations visible, no recommendation surfaced ---
  it('L2 Annotator: annotations in event log, result not applied to workflow', async () => {
    const envelope = makeValidEnvelope({
      annotations: [
        { id: crypto.randomUUID(), content: 'High risk flag', timestamp: new Date().toISOString() },
      ],
    });
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L2' });
    const stepConfig = makeStepConfig();

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(false);

    // Events (status + result) in event log
    const events = eventLog.getEvents('instance-1', 'step-1');
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // --- Test 5: L3 (Advisor) — instance paused awaiting approval ---
  it('L3 Advisor: instance paused with awaiting_agent_approval, AgentRunResult.status paused', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L3' });
    const stepConfig = makeStepConfig();

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('paused');
    expect(result.appliedToWorkflow).toBe(false);

    // Instance must be paused with correct pauseReason BEFORE returning
    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('awaiting_agent_approval');
  });

  // --- Test 6: Timeout triggers fallback ---
  it('Timeout: triggers fallback when plugin exceeds timeout', async () => {
    const envelope = makeValidEnvelope();
    // 100ms delay, 0.0001 minute timeout (6ms)
    const plugin = makeSlowPlugin(100, envelope);
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig({
      timeoutMinutes: 0.0001, // ~6ms
      fallbackBehavior: 'escalate_to_human',
    });

    const result = await runner.run(plugin, context, stepConfig);

    // Should have triggered fallback
    expect(result.fallbackReason).toBe('timeout');
    expect(['escalated', 'flagged', 'paused']).toContain(result.status);
  }, 5000);

  // --- Test 7: Low confidence triggers fallback ---
  it('Low confidence: triggers fallback when confidence below threshold', async () => {
    const envelope = makeValidEnvelope({ confidence: 0.5 });
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig({
      confidenceThreshold: 0.8,
      fallbackBehavior: 'continue_with_flag',
    });

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.fallbackReason).toBe('low_confidence');
    expect(result.status).toBe('flagged');
  });

  // --- Test 8: Invalid result envelope triggers error fallback ---
  it('Invalid envelope: triggers error fallback when result payload fails schema validation', async () => {
    const plugin = makeInvalidEnvelopePlugin();
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig({
      fallbackBehavior: 'continue_with_flag',
    });

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.fallbackReason).toBe('error');
    expect(result.status).toBe('flagged');
  });

  // --- Test 9: Audit event fields (COMP-05) ---
  it('Audit event contains all COMP-05 required fields after successful run', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig({ model: 'anthropic/claude-sonnet-4' });

    await runner.run(plugin, context, stepConfig);

    const audits = auditRepository.getAll();
    expect(audits).toHaveLength(1);

    const audit = audits[0];
    expect(audit.actorType).toBe('agent');
    expect(audit.actorRole).toBe('L4');
    expect(audit.inputSnapshot).toMatchObject({
      stepInput: expect.any(Object),
      autonomyLevel: 'L4',
      model: 'anthropic/claude-sonnet-4',
    });
    expect(audit.outputSnapshot).toMatchObject({
      confidence: expect.any(Number),
      duration_ms: expect.any(Number),
      reasoning_summary: expect.any(String),
    });
  });

  // --- Test 10: Plugin emitting multiple events before result ---
  it('Multi-event plugin: all events in event log (2 status + 1 annotation + 1 result)', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeMultiEventPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig();

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('completed');

    const events = eventLog.getEvents('instance-1', 'step-1');
    expect(events).toHaveLength(4); // 2 status + 1 annotation + 1 result

    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();
  });

  // --- Audit on fallback ---
  it('Audit event is appended even on fallback (error case)', async () => {
    const plugin = makeInvalidEnvelopePlugin();
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });

    await runner.run(plugin, context, stepConfig);

    expect(auditRepository.getAll()).toHaveLength(1);
    expect(auditRepository.getAll()[0].actorType).toBe('agent');
  });

  // --- Plugin throws a raw Error ---

  it('plugin throw: fallbackReason is error, instance paused with agent_escalated', async () => {
    const plugin: AgentPlugin = {
      initialize: async () => {},
      run: async () => { throw new Error('LLM API key invalid'); },
    };
    const context = makeContext({ autonomyLevel: 'L2' });
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('error');
    expect(result.envelope).toBeNull();

    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.status).toBe('paused');
    expect(instance?.pauseReason).toBe('agent_escalated');
  });

  it('plugin throw: error message is captured in audit outputSnapshot', async () => {
    const plugin: AgentPlugin = {
      initialize: async () => {},
      run: async () => { throw new Error('OpenRouter 401 Unauthorized'); },
    };
    const context = makeContext({ autonomyLevel: 'L2' });
    const stepConfig = makeStepConfig({ fallbackBehavior: 'escalate_to_human' });

    await runner.run(plugin, context, stepConfig);

    const audits = auditRepository.getAll();
    expect(audits).toHaveLength(1);
    expect(audits[0].outputSnapshot).toMatchObject({
      status: 'escalated',
      error: 'OpenRouter 401 Unauthorized',
    });
  });

  it('plugin throw after partial work: partial events preserved in event log', async () => {
    const plugin: AgentPlugin = {
      initialize: async () => {},
      run: async (emit: EmitFn) => {
        await emit({ type: 'status', payload: 'Starting...', timestamp: new Date().toISOString() });
        throw new Error('Firestore unavailable');
      },
    };
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig({ fallbackBehavior: 'continue_with_flag' });

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.fallbackReason).toBe('error');
    const events = eventLog.getEvents('instance-1', 'step-1');
    expect(events.some((e) => e.type === 'status')).toBe(true);
  });

  it('plugin throw: audit event written even when no result emitted', async () => {
    const plugin: AgentPlugin = {
      initialize: async () => {},
      run: async () => { throw new TypeError('Cannot read properties of undefined'); },
    };
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig();

    await runner.run(plugin, context, stepConfig);

    expect(auditRepository.getAll()).toHaveLength(1);
    expect(auditRepository.getAll()[0].action).toBe('agent.run');
  });

  // --- executorType/reviewerType top-level audit fields ---

  it('audit event includes executorType=agent and reviewerType=none for L4', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L4' });
    const stepConfig = makeStepConfig();

    await runner.run(plugin, context, stepConfig);

    const audits = auditRepository.getAll();
    expect(audits[0]).toMatchObject({
      executorType: 'agent',
      reviewerType: 'none',
    });
  });

  it('audit event includes executorType=agent and reviewerType=human for L3 (default)', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L3' });
    const stepConfig = makeStepConfig();

    await runner.run(plugin, context, stepConfig);

    const audits = auditRepository.getAll();
    expect(audits[0]).toMatchObject({
      executorType: 'agent',
      reviewerType: 'human',
    });
  });

  it('audit event includes reviewerType=agent when stepConfig.reviewerType=agent', async () => {
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeContext({ autonomyLevel: 'L3' });
    const stepConfig = makeStepConfig({ reviewerType: 'agent', reviewerPlugin: 'my-reviewer' });

    await runner.run(plugin, context, stepConfig);

    const audits = auditRepository.getAll();
    expect(audits[0]).toMatchObject({
      executorType: 'agent',
      reviewerType: 'agent',
    });
  });

  it('audit event includes executorType=agent and reviewerType=none for L0/L1/L2', async () => {
    for (const level of ['L0', 'L1', 'L2'] as const) {
      auditRepository.clear();
      const envelope = makeValidEnvelope();
      const plugin = makeSuccessPlugin(envelope);
      const context = makeContext({ autonomyLevel: level });
      const stepConfig = makeStepConfig();

      await runner.run(plugin, context, stepConfig);

      const audits = auditRepository.getAll();
      expect(audits[0]).toMatchObject({
        executorType: 'agent',
        reviewerType: 'none',
      });
    }
  });
});
