import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from './agent-runner';
import { PluginRunner } from './plugin-runner';
import {
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryAgentRunRepository,
  InMemoryAgentTrajectoryRepository,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { InMemoryAgentEventLog } from '../testing/index';
import { NoopLlmClient } from '../testing/index';
import type {
  AgentOutputGate,
  StepExecutorPlugin,
  AgentContext,
  EmitFn,
  WorkflowAgentContext,
} from '../interfaces/step-executor-plugin';
import type {
  StepConfig,
  ProcessConfig,
  AgentOutputEnvelope,
} from '@mediforce/platform-core';
import { trace } from '@opentelemetry/api';
import { RecordingTracerProvider } from '../testing/index';

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

function makeWorkflowContext(overrides: Partial<WorkflowAgentContext> = {}): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: 'step-1',
    name: 'Review output',
    type: 'review',
    executor: 'agent',
    plugin: 'test-plugin',
    agent: {
      model: 'anthropic/claude-sonnet-4',
    },
  };

  return {
    stepId: 'step-1',
    processInstanceId: 'instance-1',
    runNamespace: 'acme-trials',
    definitionVersion: '7',
    stepInput: { patientId: 'P001' },
    autonomyLevel: 'L4',
    workflowDefinition: buildWorkflowDefinition({
      name: 'Protocol Review',
      version: 7,
      namespace: 'acme-trials',
      steps: [step],
      transitions: [],
    }),
    step,
    llm: new NoopLlmClient(),
    getPreviousStepOutputs: async () => ({}),
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
function makeSuccessPlugin(envelope: AgentOutputEnvelope): StepExecutorPlugin {
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
function makeSlowPlugin(delayMs: number, envelope: AgentOutputEnvelope): StepExecutorPlugin {
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
function makeInvalidEnvelopePlugin(): StepExecutorPlugin {
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
function makeMultiEventPlugin(envelope: AgentOutputEnvelope): StepExecutorPlugin {
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
    dryRun: false,
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

  afterEach(() => {
    trace.disable();
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

  it('runWithWorkflowStep emits an OpenTelemetry root span with workflow correlation attributes', async () => {
    const tracerProvider = new RecordingTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);
    const context = makeWorkflowContext();

    const result = await runner.runWithWorkflowStep(plugin, context);

    expect(result.status).toBe('completed');

    const span = tracerProvider.spans[0];
    expect(span.name).toBe('mediforce.agent.run');
    expect(span.attributes['mediforce.agent_run.id']).toEqual(expect.any(String));
    expect(span.attributes['mediforce.process_instance.id']).toBe('instance-1');
    expect(span.attributes['mediforce.namespace']).toBe('acme-trials');
    expect(span.attributes['mediforce.workflow.name']).toBe('Protocol Review');
    expect(span.attributes['mediforce.workflow.version']).toBe(7);
    expect(span.attributes['mediforce.workflow.step_id']).toBe('step-1');
    expect(span.attributes['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4');
    expect(span.attributes['openinference.span.kind']).toBe('AGENT');
    expect(span.ended).toBe(true);
  });

  it('does not record run input/output on the span by default (content capture off)', async () => {
    const tracerProvider = new RecordingTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    const plugin = makeSuccessPlugin(makeValidEnvelope());
    await runner.runWithWorkflowStep(plugin, makeWorkflowContext());

    const span = tracerProvider.spans[0];
    expect(span.attributes['input.value']).toBeUndefined();
    expect(span.attributes['output.value']).toBeUndefined();
  });

  it('records run input/output on the span when content capture is enabled', async () => {
    const tracerProvider = new RecordingTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    const capturingRunner = new AgentRunner(
      instanceRepository,
      auditRepository,
      eventLog,
      undefined,
      { captureContent: true },
    );
    const plugin = makeSuccessPlugin(makeValidEnvelope());
    await capturingRunner.runWithWorkflowStep(plugin, makeWorkflowContext());

    const span = tracerProvider.spans[0];
    expect(span.attributes['input.value']).toBe(JSON.stringify({ patientId: 'P001' }));
    expect(span.attributes['output.value']).toBe(
      JSON.stringify({ recommendation: 'continue_monitoring' }),
    );
    expect(span.attributes['output.mime_type']).toBe('application/json');
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
    const plugin: StepExecutorPlugin = {
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
    const plugin: StepExecutorPlugin = {
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
    const plugin: StepExecutorPlugin = {
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
    const plugin: StepExecutorPlugin = {
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

describe('AgentRunner.reapAsTimeout (issue #868)', () => {
  it('terminates the orphaned running AgentRun, routes through the timeout fallback, and names the run', async () => {
    const instanceRepository = new InMemoryProcessInstanceRepository();
    const auditRepository = new InMemoryAuditRepository();
    const eventLog = new InMemoryAgentEventLog();
    const agentRunRepo = new InMemoryAgentRunRepository();
    await createTestInstance(instanceRepository);
    const runner = new AgentRunner(instanceRepository, auditRepository, eventLog, agentRunRepo);

    await agentRunRepo.create({
      id: 'run-stranded',
      processInstanceId: 'instance-1',
      stepId: 'step-1',
      pluginId: 'test-plugin',
      autonomyLevel: 'L4',
      status: 'running',
      envelope: null,
      fallbackReason: null,
      startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      completedAt: null,
    });

    const step: WorkflowStep = {
      id: 'step-1',
      name: 'Review output',
      type: 'review',
      executor: 'agent',
      plugin: 'test-plugin',
      agent: { model: 'anthropic/claude-sonnet-4', fallbackBehavior: 'escalate_to_human' },
    };

    const result = await runner.reapAsTimeout(makeWorkflowContext({ step }));

    expect(result.fallbackReason).toBe('timeout');
    expect(result.status).toBe('escalated');
    expect(result.agentRunId).toBe('run-stranded');

    const stranded = await agentRunRepo.getById('run-stranded');
    expect(stranded?.status).toBe('escalated');
    expect(stranded?.fallbackReason).toBe('timeout');
    expect(stranded?.completedAt).not.toBeNull();

    const inst = await instanceRepository.getById('instance-1');
    expect(inst?.status).toBe('paused');
    expect(inst?.pauseReason).toBe('agent_escalated');
  });
});

describe('AgentRunner in-flight cancel guard', () => {
  it('does not resurrect an AgentRun that cancelRun reaped to error while the plugin was running', async () => {
    const instanceRepository = new InMemoryProcessInstanceRepository();
    const auditRepository = new InMemoryAuditRepository();
    const eventLog = new InMemoryAgentEventLog();
    const agentRunRepo = new InMemoryAgentRunRepository();
    await createTestInstance(instanceRepository);
    const runner = new AgentRunner(instanceRepository, auditRepository, eventLog, agentRunRepo);

    const envelope = makeValidEnvelope();
    // Plugin that mid-run reproduces cancelRun's reaping: flip the still-running
    // AgentRun to `error` and the instance to `failed`, then emit a valid result.
    const cancellingPlugin: StepExecutorPlugin = {
      initialize: async () => {},
      run: async (emit: EmitFn) => {
        const running = (await agentRunRepo.getByInstanceId('instance-1'))
          .filter((run) => run.status === 'running');
        for (const run of running) {
          await agentRunRepo.update(run.id, {
            status: 'error',
            fallbackReason: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          });
        }
        await instanceRepository.update('instance-1', { status: 'failed', error: 'Cancelled by user' });
        await emit({ type: 'result', payload: envelope, timestamp: new Date().toISOString() });
      },
    };

    await runner.runWithWorkflowStep(cancellingPlugin, makeWorkflowContext({ autonomyLevel: 'L4' }));

    const runs = await agentRunRepo.getByInstanceId('instance-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('error');
    expect(runs[0]!.fallbackReason).toBe('Cancelled by user');
  });
});

describe('AgentRunner.markStepRunsInterrupted (issue #907)', () => {
  it('terminalizes only the running AgentRun(s) of the given step as interrupted', async () => {
    const instanceRepository = new InMemoryProcessInstanceRepository();
    const auditRepository = new InMemoryAuditRepository();
    const eventLog = new InMemoryAgentEventLog();
    const agentRunRepo = new InMemoryAgentRunRepository();
    await createTestInstance(instanceRepository);
    const runner = new AgentRunner(instanceRepository, auditRepository, eventLog, agentRunRepo);

    const base = {
      processInstanceId: 'instance-1',
      pluginId: 'test-plugin',
      autonomyLevel: 'L4' as const,
      envelope: null,
      fallbackReason: null,
      startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    };
    // Orphaned running run for the interrupted step — should be terminalized.
    await agentRunRepo.create({ ...base, id: 'run-interrupted', stepId: 'step-1', status: 'running', completedAt: null });
    // A completed run of the same step — must be left untouched.
    await agentRunRepo.create({ ...base, id: 'run-done', stepId: 'step-1', status: 'completed', completedAt: new Date().toISOString() });
    // A running run of a different step — must be left untouched.
    await agentRunRepo.create({ ...base, id: 'run-other-step', stepId: 'step-2', status: 'running', completedAt: null });

    const count = await runner.markStepRunsInterrupted('instance-1', 'step-1');

    expect(count).toBe(1);
    const interrupted = await agentRunRepo.getById('run-interrupted');
    expect(interrupted?.status).toBe('interrupted');
    expect(interrupted?.completedAt).not.toBeNull();
    expect((await agentRunRepo.getById('run-done'))?.status).toBe('completed');
    expect((await agentRunRepo.getById('run-other-step'))?.status).toBe('running');
  });

  it('is a no-op when the step has no running AgentRun (e.g. script steps)', async () => {
    const instanceRepository = new InMemoryProcessInstanceRepository();
    const agentRunRepo = new InMemoryAgentRunRepository();
    await createTestInstance(instanceRepository);
    const runner = new AgentRunner(instanceRepository, new InMemoryAuditRepository(), new InMemoryAgentEventLog(), agentRunRepo);

    const count = await runner.markStepRunsInterrupted('instance-1', 'step-1');
    expect(count).toBe(0);
  });
});

describe('AgentRunner outputSchema (ADR-0023 D13)', () => {
  const outputSchema = { type: 'object' as const, required: ['findings'], properties: { findings: { type: 'array' as const } } };

  function makeSchemaStepContext(
    fallbackBehavior: 'escalate_to_human' | 'continue_with_flag' | 'pause',
  ): WorkflowAgentContext {
    const base = makeWorkflowContext({ autonomyLevel: 'L4' });
    return {
      ...base,
      step: { ...base.step, agent: { ...base.step.agent, outputSchema, fallbackBehavior } },
    };
  }

  /** Emits each envelope in turn — one per attempt — and records the context each attempt saw. */
  function makeScriptedPlugin(envelopes: AgentOutputEnvelope[]) {
    const seenContexts: WorkflowAgentContext[] = [];
    let attempt = 0;
    const plugin: StepExecutorPlugin = {
      initialize: async (context) => {
        seenContexts.push(context as WorkflowAgentContext);
      },
      run: async (emit: EmitFn) => {
        const envelope = envelopes[Math.min(attempt, envelopes.length - 1)]!;
        attempt += 1;
        await emit({ type: 'result', payload: envelope, timestamp: new Date().toISOString() });
      },
    };
    return { plugin, seenContexts };
  }

  let instanceRepository: InMemoryProcessInstanceRepository;
  let eventLog: InMemoryAgentEventLog;
  let runner: AgentRunner;

  beforeEach(async () => {
    instanceRepository = new InMemoryProcessInstanceRepository();
    eventLog = new InMemoryAgentEventLog();
    runner = new AgentRunner(instanceRepository, new InMemoryAuditRepository(), eventLog);
    await createTestInstance(instanceRepository);
  });

  it('accepts a conforming result on the first attempt without retrying', async () => {
    const { plugin, seenContexts } = makeScriptedPlugin([makeValidEnvelope({ result: { findings: [] } })]);

    const result = await runner.runWithWorkflowStep(plugin, makeSchemaStepContext('continue_with_flag'));

    expect(result.status).toBe('completed');
    expect(result.fallbackReason).toBeNull();
    expect(seenContexts).toHaveLength(1);
  });

  it('retries once with the validation error and accepts a corrected result', async () => {
    const { plugin, seenContexts } = makeScriptedPlugin([
      makeValidEnvelope({ result: { summary: 'no findings key' } }),
      makeValidEnvelope({ result: { findings: ['AE grade 3'] } }),
    ]);

    const result = await runner.runWithWorkflowStep(plugin, makeSchemaStepContext('continue_with_flag'));

    expect(result.status).toBe('completed');
    expect(result.envelope?.result).toEqual({ findings: ['AE grade 3'] });
    expect(seenContexts).toHaveLength(2);
    expect(seenContexts[0]!.outputSchemaViolation).toBeUndefined();
    expect(seenContexts[1]!.outputSchemaViolation).toBe('missing required keys: findings');
    const statuses = eventLog.getEvents('instance-1', 'step-1')
      .filter((event) => event.type === 'status')
      .map((event) => String(event.payload));
    expect(statuses.some((payload) => payload.includes('missing required keys: findings'))).toBe(true);
  });

  it('routes a second violation to fallbackBehavior with reason output_schema', async () => {
    const { plugin, seenContexts } = makeScriptedPlugin([
      makeValidEnvelope({ result: { summary: 'still wrong' } }),
    ]);

    const result = await runner.runWithWorkflowStep(plugin, makeSchemaStepContext('escalate_to_human'));

    expect(seenContexts).toHaveLength(2);
    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('output_schema');
    expect(result.errorMessage).toContain('missing required keys: findings');
    const instance = await instanceRepository.getById('instance-1');
    expect(instance?.pauseReason).toBe('agent_escalated');
  });

  it('does not retry a non-schema failure', async () => {
    const { plugin, seenContexts } = makeScriptedPlugin([
      makeValidEnvelope({ confidence: 0.2, result: { findings: [] } }),
    ]);
    const context = makeSchemaStepContext('continue_with_flag');
    const lowThresholdContext = {
      ...context,
      step: { ...context.step, agent: { ...context.step.agent, confidenceThreshold: 0.8 } },
    };

    const result = await runner.runWithWorkflowStep(plugin, lowThresholdContext);

    expect(result.fallbackReason).toBe('low_confidence');
    expect(seenContexts).toHaveLength(1);
  });

  describe('output gate — production Evaluators (D13)', () => {
    function gatedContext(gate: AgentOutputGate, fallbackBehavior: 'escalate_to_human' | 'continue_with_flag' = 'escalate_to_human'): WorkflowAgentContext {
      return { ...makeSchemaStepContext(fallbackBehavior), outputGate: gate };
    }

    function statuses(): string[] {
      return eventLog.getEvents('instance-1', 'step-1')
        .filter((event) => event.type === 'status')
        .map((event) => String(event.payload));
    }

    it('hands a conforming result to the gate with its Agent Run and lets a pass through', async () => {
      const gate = vi.fn<AgentOutputGate>().mockResolvedValue({ failure: null, errors: [] });
      const { plugin } = makeScriptedPlugin([makeValidEnvelope({ result: { findings: [] } })]);

      const result = await runner.runWithWorkflowStep(plugin, gatedContext(gate));

      expect(result.status).toBe('completed');
      expect(result.fallbackReason).toBeNull();
      expect(gate).toHaveBeenCalledOnce();
      const [call] = gate.mock.calls[0]!;
      expect(call.agentRunId).toBe(result.agentRunId);
      expect(call.envelope.result).toEqual({ findings: [] });
    });

    it('routes a gate failure to fallbackBehavior with reason production_evaluator', async () => {
      const auditRepository = new InMemoryAuditRepository();
      runner = new AgentRunner(instanceRepository, auditRepository, eventLog);
      const gate: AgentOutputGate = async () => ({ failure: "Evaluator 'grade-5-flagged' v1 failed: grade 4 on a fatal AE", errors: [] });
      const { plugin } = makeScriptedPlugin([makeValidEnvelope({ result: { findings: [] } })]);

      const result = await runner.runWithWorkflowStep(plugin, gatedContext(gate));

      expect(result.status).toBe('escalated');
      expect(result.fallbackReason).toBe('production_evaluator');
      expect(result.errorMessage).toContain('grade 4 on a fatal AE');
      expect((await instanceRepository.getById('instance-1'))?.pauseReason).toBe('agent_escalated');
      expect(statuses().some((payload) => payload.includes('failed a production Evaluator'))).toBe(true);
      const [audit] = await auditRepository.getByProcess('instance-1');
      expect(audit?.outputSnapshot).toMatchObject({ error: expect.stringContaining('grade 4 on a fatal AE') });
    });

    it('keeps a low-confidence signal in the error when the gate fails too', async () => {
      const gate: AgentOutputGate = async () => ({ failure: "Evaluator 'grade-5-flagged' v1 failed", errors: [] });
      const { plugin } = makeScriptedPlugin([makeValidEnvelope({ confidence: 0.5, result: { findings: [] } })]);
      const context = gatedContext(gate);
      const lowThresholdContext = {
        ...context,
        step: { ...context.step, agent: { ...context.step.agent, confidenceThreshold: 0.8 } },
      };

      const result = await runner.runWithWorkflowStep(plugin, lowThresholdContext);

      expect(result.fallbackReason).toBe('production_evaluator');
      expect(result.errorMessage).toContain('grade-5-flagged');
      expect(result.errorMessage).toContain('below the confidence threshold');
    });

    it('never gates a result that still broke outputSchema', async () => {
      const gate = vi.fn<AgentOutputGate>().mockResolvedValue({ failure: null, errors: [] });
      const { plugin } = makeScriptedPlugin([makeValidEnvelope({ result: { summary: 'still wrong' } })]);

      const result = await runner.runWithWorkflowStep(plugin, gatedContext(gate));

      expect(result.fallbackReason).toBe('output_schema');
      expect(gate).not.toHaveBeenCalled();
    });

    it('records checks that could not run, and a gate that throws, without failing the run', async () => {
      const { plugin } = makeScriptedPlugin([makeValidEnvelope({ result: { findings: [] } })]);
      const withErrors = await runner.runWithWorkflowStep(
        plugin,
        gatedContext(async () => ({ failure: null, errors: ['grade-5-flagged: script crashed'] })),
      );
      const thrown = await runner.runWithWorkflowStep(plugin, gatedContext(async () => {
        throw new Error('database unreachable');
      }));

      expect(withErrors.status).toBe('completed');
      expect(thrown.status).toBe('completed');
      expect(statuses()).toEqual(expect.arrayContaining([
        expect.stringContaining('grade-5-flagged: script crashed'),
        expect.stringContaining('database unreachable'),
      ]));
    });
  });

  describe('retry budget — both attempts fit inside one step timeout', () => {
    const STEP_TIMEOUT_MS = 10 * 60_000;

    function makeTimedSchemaStepContext(): WorkflowAgentContext {
      const context = makeSchemaStepContext('escalate_to_human');
      return {
        ...context,
        step: { ...context.step, agent: { ...context.step.agent, timeoutMinutes: STEP_TIMEOUT_MS / 60_000 } },
      };
    }

    /** A plugin whose first attempt takes `firstAttemptMs` of wall-clock time and violates the schema. */
    function makeSlowViolatingPlugin(firstAttemptMs: number) {
      const scripted = makeScriptedPlugin([
        makeValidEnvelope({ result: { summary: 'no findings key' } }),
        makeValidEnvelope({ result: { findings: [] } }),
      ]);
      const run = scripted.plugin.run;
      let attempts = 0;
      scripted.plugin.run = async (emit: EmitFn) => {
        if (attempts === 0) vi.setSystemTime(Date.now() + firstAttemptMs);
        attempts += 1;
        await run(emit);
      };
      return scripted;
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('gives the retry only the budget the first attempt left', async () => {
      const execute = vi.spyOn(PluginRunner.prototype, 'execute');
      const { plugin, seenContexts } = makeSlowViolatingPlugin(4 * 60_000);

      const result = await runner.runWithWorkflowStep(plugin, makeTimedSchemaStepContext());

      expect(seenContexts).toHaveLength(2);
      expect(result.status).toBe('completed');
      expect(execute.mock.calls.map((call) => call[2])).toEqual([STEP_TIMEOUT_MS, 6 * 60_000]);
    });

    it('skips the retry and takes the output_schema fallback when the budget is spent', async () => {
      const { plugin, seenContexts } = makeSlowViolatingPlugin(STEP_TIMEOUT_MS);

      const result = await runner.runWithWorkflowStep(plugin, makeTimedSchemaStepContext());

      expect(seenContexts).toHaveLength(1);
      expect(result.fallbackReason).toBe('output_schema');
      expect(result.status).toBe('escalated');
      expect(result.errorMessage).toContain('missing required keys: findings');
    });
  });
});

describe('AgentRunner Agent Trajectory (ADR-0023 D8)', () => {
  function makeRecordingPlugin(): StepExecutorPlugin {
    let context: WorkflowAgentContext | null = null;
    return {
      initialize: async (ctx) => {
        context = ctx as WorkflowAgentContext;
      },
      run: async (emit: EmitFn) => {
        context?.trajectory?.record([
          { ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: '/data/ae.csv' } },
        ]);
        await emit({ type: 'result', payload: makeValidEnvelope(), timestamp: new Date().toISOString() });
      },
    };
  }

  async function setup(captureContent: boolean) {
    const instanceRepository = new InMemoryProcessInstanceRepository();
    await createTestInstance(instanceRepository);
    const agentRunRepo = new InMemoryAgentRunRepository();
    const trajectoryRepo = new InMemoryAgentTrajectoryRepository(agentRunRepo);
    const runner = new AgentRunner(
      instanceRepository, new InMemoryAuditRepository(), new InMemoryAgentEventLog(), agentRunRepo,
      { captureContent }, trajectoryRepo,
    );
    return { runner, agentRunRepo, trajectoryRepo };
  }

  it('stores what the plugin recorded under the Agent Run id, flushed before the run returns', async () => {
    const { runner, agentRunRepo, trajectoryRepo } = await setup(true);

    await runner.runWithWorkflowStep(makeRecordingPlugin(), makeWorkflowContext());

    const [agentRun] = await agentRunRepo.getByInstanceId('instance-1');
    const entries = await trajectoryRepo.list(agentRun!.id);
    expect(entries).toEqual([
      { seq: 0, ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: '/data/ae.csv' } },
    ]);
  });

  it('keeps full content when span content capture is off — the switch governs exported spans only (ADR-0007 D5)', async () => {
    const { runner, agentRunRepo, trajectoryRepo } = await setup(false);

    await runner.runWithWorkflowStep(makeRecordingPlugin(), makeWorkflowContext());

    const [agentRun] = await agentRunRepo.getByInstanceId('instance-1');
    const [entry] = (await trajectoryRepo.list(agentRun!.id)) ?? [];
    expect(entry).toEqual({
      seq: 0, ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: '/data/ae.csv' },
    });
  });
});
