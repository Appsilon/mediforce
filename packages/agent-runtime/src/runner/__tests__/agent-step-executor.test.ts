import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentStepExecutor } from '../agent-step-executor';
import type { StepExecutorServices, StepExecutorMeta } from '../step-executor';
import type { StepExecutorPlugin, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import { buildAgentOutputEnvelope, buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { WorkflowStep } from '@mediforce/platform-core';

const mockAgentRunner = {
  runWithWorkflowStep: vi.fn(),
  reapAsTimeout: vi.fn(),
};

const mockAuditRepo = { append: vi.fn() };
const mockInstanceRepo = {
  getById: vi.fn(),
  update: vi.fn(),
  updateStepExecution: vi.fn(),
  getStepExecutions: vi.fn().mockResolvedValue([]),
};
const mockEngine = {
  advanceStep: vi.fn(),
  submitReviewVerdict: vi.fn(),
};
const mockHumanTaskRepo = { create: vi.fn() };
const mockModelRegistryRepo = { getById: vi.fn().mockResolvedValue(null) };

const services: StepExecutorServices = {
  auditRepo: mockAuditRepo,
  instanceRepo: mockInstanceRepo,
  engine: mockEngine,
  humanTaskRepo: mockHumanTaskRepo,
  modelRegistryRepo: mockModelRegistryRepo,
};

const agentStep: WorkflowStep = {
  id: 'analyze-data',
  name: 'Analyze Data',
  type: 'creation',
  executor: 'agent',
  autonomyLevel: 'L2',
};

const workflowDefinition = buildWorkflowDefinition({
  name: 'analysis-pipeline',
  version: 1,
  steps: [agentStep, { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
  transitions: [{ from: 'analyze-data', to: 'done' }],
});

const defaultEnvelope = buildAgentOutputEnvelope({
  result: { summary: 'analysis complete' },
});

const mockPlugin: StepExecutorPlugin = {
  initialize: vi.fn(),
  run: vi.fn(),
};

function makeContext(overrides?: Partial<WorkflowAgentContext>): WorkflowAgentContext {
  return {
    stepId: 'analyze-data',
    processInstanceId: 'inst-001',
    runNamespace: 'acme',
    definitionVersion: '1',
    stepInput: {},
    autonomyLevel: 'L2',
    workflowDefinition,
    step: agentStep,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

const meta: StepExecutorMeta = {
  instanceId: 'inst-001',
  stepId: 'analyze-data',
  pluginId: 'claude-code-agent',
  triggeredBy: 'auto-runner',
  stepExecutionId: 'exec-001',
  definitionVersion: '1',
};

describe('AgentStepExecutor', () => {
  let executor: AgentStepExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AgentStepExecutor(mockAgentRunner as never);
    mockInstanceRepo.getById.mockResolvedValue({
      status: 'running',
      currentStepId: 'analyze-data',
      definitionVersion: '1',
      variables: {},
    });
    mockEngine.advanceStep.mockResolvedValue({
      status: 'running',
      currentStepId: 'done',
    });
  });

  it('delegates to AgentRunner.runWithWorkflowStep', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockAgentRunner.runWithWorkflowStep).toHaveBeenCalledWith(
      mockPlugin,
      expect.objectContaining({ stepId: 'analyze-data' }),
    );
  });

  it('returns executorType=agent', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);
    expect(result.executorType).toBe('agent');
  });

  it('emits agent.step.started audit event', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.step.started',
        actorId: 'agent:claude-code-agent',
        actorType: 'agent',
        executorType: 'agent',
      }),
    );
  });

  it('L2 completed: calls advanceStep', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockEngine.advanceStep).toHaveBeenCalledWith(
      'inst-001',
      { summary: 'analysis complete' },
      { id: 'auto-runner', role: 'agent' },
      undefined,
    );
    expect(result.instanceState?.currentStepId).toBe('done');
  });

  it('L4 appliedToWorkflow: calls advanceStep with runResult', async () => {
    const runResult = {
      status: 'completed' as const,
      envelope: defaultEnvelope,
      appliedToWorkflow: true,
      fallbackReason: null,
    };
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue(runResult);

    const l4Context = makeContext({ autonomyLevel: 'L4', step: { ...agentStep, autonomyLevel: 'L4' } });
    const result = await executor.execute(mockPlugin, l4Context, services, meta);

    expect(mockEngine.advanceStep).toHaveBeenCalledWith(
      'inst-001',
      { summary: 'analysis complete' },
      { id: 'auto-runner', role: 'agent' },
      undefined,
      runResult,
    );
    expect(result.appliedToWorkflow).toBe(true);
  });

  it('escalated: emits agent.escalated audit, does NOT call advanceStep', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'escalated',
      envelope: null,
      appliedToWorkflow: false,
      fallbackReason: 'error',
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(result.status).toBe('escalated');
    expect(mockEngine.advanceStep).not.toHaveBeenCalled();
    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.escalated',
      }),
    );
  });

  it('L3 paused: creates HumanTask for review', async () => {
    const l3Step: WorkflowStep = { ...agentStep, autonomyLevel: 'L3', allowedRoles: ['reviewer'] };
    const l3Context = makeContext({ autonomyLevel: 'L3', step: l3Step });
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'paused',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    const result = await executor.execute(mockPlugin, l3Context, services, meta);

    expect(result.status).toBe('paused');
    expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        processInstanceId: 'inst-001',
        stepId: 'analyze-data',
        assignedRole: 'reviewer',
        creationReason: 'agent_review_l3',
      }),
    );
  });

  it('persists step execution on completion', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
      'inst-001',
      'exec-001',
      expect.objectContaining({
        output: { summary: 'analysis complete' },
        status: 'completed',
      }),
    );
  });

  it('marks step execution as failed on error fallback', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'escalated',
      envelope: null,
      appliedToWorkflow: false,
      fallbackReason: 'error',
      errorMessage: 'plugin crashed',
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
      'inst-001',
      'exec-001',
      expect.objectContaining({
        status: 'failed',
        error: 'plugin crashed',
      }),
    );
  });

  it('persists output to instance.variables', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.update).toHaveBeenCalledWith('inst-001', expect.objectContaining({
      variables: { 'analyze-data': { summary: 'analysis complete' } },
    }));
  });
});

describe('AgentStepExecutor in-flight cancel guard', () => {
  let executor: AgentStepExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AgentStepExecutor(mockAgentRunner as never);
    // The run was cancelled (→ failed) while the plugin was still executing:
    // cancelRun already reaped this step's StepExecution/AgentRun and flipped the
    // instance to `failed`.
    mockInstanceRepo.getById.mockResolvedValue({
      status: 'failed',
      currentStepId: 'analyze-data',
      definitionVersion: '1',
      variables: {},
    });
    mockEngine.advanceStep.mockResolvedValue({ status: 'running', currentStepId: 'done' });
  });

  it('does not resurrect the reaped step execution, persist output/cost, or advance when cancelled mid-flight', async () => {
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.updateStepExecution).not.toHaveBeenCalled();
    expect(mockInstanceRepo.update).not.toHaveBeenCalled();
    expect(mockEngine.advanceStep).not.toHaveBeenCalled();
    expect(result.appliedToWorkflow).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.instanceState?.status).toBe('failed');
  });

  it('proceeds normally when the instance is still active (paused) — no false positive', async () => {
    mockInstanceRepo.getById.mockResolvedValue({
      status: 'paused',
      currentStepId: 'analyze-data',
      definitionVersion: '1',
      variables: {},
    });
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalled();
  });
});

describe('AgentStepExecutor reap mode (issue #868)', () => {
  let executor: AgentStepExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AgentStepExecutor(mockAgentRunner as never);
    mockInstanceRepo.getById.mockResolvedValue({
      status: 'paused', currentStepId: 'analyze-data', definitionVersion: '1', variables: {},
    });
    mockAgentRunner.reapAsTimeout.mockResolvedValue({
      status: 'escalated', envelope: null, appliedToWorkflow: false,
      fallbackReason: 'timeout', errorMessage: 'stranded',
    });
  });

  it('reaps via reapAsTimeout instead of running the plugin, and does not emit a started audit', async () => {
    const reapMeta: StepExecutorMeta = { ...meta, stepExecutionId: 'exec-stranded', reapTimedOut: true };

    const result = await executor.execute(mockPlugin, makeContext(), services, reapMeta);

    expect(mockAgentRunner.reapAsTimeout).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'analyze-data' }),
    );
    expect(mockAgentRunner.runWithWorkflowStep).not.toHaveBeenCalled();
    expect(result.fallbackReason).toBe('timeout');
    expect(mockAuditRepo.append).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.step.started' }),
    );
    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
      'inst-001', 'exec-stranded', expect.objectContaining({ status: 'failed' }),
    );
  });
});
