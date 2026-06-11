import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptStepExecutor } from '../script-step-executor';
import type { PluginRunResult } from '../plugin-runner';
import type { StepExecutorServices, StepExecutorMeta } from '../step-executor';
import type { AgentPlugin, WorkflowAgentContext } from '../../interfaces/agent-plugin';
import { buildStepOutputEnvelope, buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import type { WorkflowStep } from '@mediforce/platform-core';

const mockPluginRunner = {
  execute: vi.fn<[], Promise<PluginRunResult>>(),
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

const scriptStep: WorkflowStep = {
  id: 'transform-data',
  name: 'Transform Data',
  type: 'creation',
  executor: 'script',
  script: { command: 'python transform.py', timeoutMinutes: 10 },
};

const workflowDefinition = buildWorkflowDefinition({
  name: 'etl-pipeline',
  version: 1,
  steps: [scriptStep, { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
  transitions: [{ from: 'transform-data', to: 'done' }],
});

const mockPlugin: AgentPlugin = {
  initialize: vi.fn(),
  run: vi.fn(),
};

function makeContext(overrides?: Partial<WorkflowAgentContext>): WorkflowAgentContext {
  return {
    stepId: 'transform-data',
    processInstanceId: 'inst-001',
    runNamespace: 'acme',
    definitionVersion: '1',
    stepInput: { source: 'raw-data.csv' },
    autonomyLevel: 'L4',
    workflowDefinition,
    step: scriptStep,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

const meta: StepExecutorMeta = {
  instanceId: 'inst-001',
  stepId: 'transform-data',
  pluginId: 'script-container',
  triggeredBy: 'auto-runner',
  stepExecutionId: 'exec-001',
  definitionVersion: '1',
};

describe('ScriptStepExecutor', () => {
  let executor: ScriptStepExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ScriptStepExecutor(mockPluginRunner as never);
    mockInstanceRepo.getById.mockResolvedValue({
      status: 'running',
      currentStepId: 'transform-data',
      definitionVersion: '1',
      variables: {},
    });
    mockEngine.advanceStep.mockResolvedValue({
      status: 'running',
      currentStepId: 'done',
    });
  });

  it('successful execution: validates with StepOutputEnvelopeSchema, advances step', async () => {
    const envelope = buildStepOutputEnvelope({ result: { rows: 42 } });
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: envelope,
      timedOut: false,
      errorMessage: null,
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(result.executorType).toBe('script');
    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.envelope?.result).toEqual({ rows: 42 });

    expect(mockEngine.advanceStep).toHaveBeenCalledWith(
      'inst-001',
      { rows: 42 },
      { id: 'auto-runner', role: 'agent' },
    );

    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'script.step.started',
        actorId: 'script:script-container',
        actorType: 'system',
        executorType: 'script',
      }),
    );
  });

  it('persists output to instance.variables on success', async () => {
    const envelope = buildStepOutputEnvelope({ result: { rows: 42 } });
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: envelope,
      timedOut: false,
      errorMessage: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.update).toHaveBeenCalledWith('inst-001', {
      variables: { 'transform-data': { rows: 42 } },
    });
  });

  it('persists step execution output on success', async () => {
    const envelope = buildStepOutputEnvelope({ result: { rows: 42 } });
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: envelope,
      timedOut: false,
      errorMessage: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
      'inst-001',
      'exec-001',
      expect.objectContaining({
        output: { rows: 42 },
        status: 'completed',
      }),
    );
  });

  it('plugin error: returns escalated with error fallback', async () => {
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: null,
      timedOut: false,
      errorMessage: 'ENOENT: script not found',
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('error');
    expect(result.errorMessage).toBe('ENOENT: script not found');
    expect(result.appliedToWorkflow).toBe(false);

    expect(mockEngine.advanceStep).not.toHaveBeenCalled();

    expect(mockInstanceRepo.update).toHaveBeenCalledWith('inst-001', expect.objectContaining({
      error: expect.stringContaining('ENOENT: script not found'),
    }));

    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'script.escalated',
        actorType: 'system',
      }),
    );
  });

  it('plugin timeout: returns escalated with timeout fallback', async () => {
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: null,
      timedOut: true,
      errorMessage: null,
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('timeout');
    expect(result.appliedToWorkflow).toBe(false);

    expect(mockInstanceRepo.update).toHaveBeenCalledWith('inst-001', expect.objectContaining({
      error: expect.stringContaining('timed out'),
    }));
  });

  it('marks step execution as failed on error', async () => {
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: null,
      timedOut: false,
      errorMessage: 'script crashed',
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
      'inst-001',
      'exec-001',
      expect.objectContaining({
        status: 'failed',
        error: 'script crashed',
      }),
    );
  });

  it('invalid envelope: treats as error', async () => {
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: { not_a_valid_envelope: true },
      timedOut: false,
      errorMessage: null,
    });

    const result = await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(result.status).toBe('escalated');
    expect(result.fallbackReason).toBe('error');
  });

  it('does not call humanTaskRepo or submitReviewVerdict (no autonomy/review)', async () => {
    const envelope = buildStepOutputEnvelope({ result: { ok: true } });
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: envelope,
      timedOut: false,
      errorMessage: null,
    });

    await executor.execute(mockPlugin, makeContext(), services, meta);

    expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
    expect(mockEngine.submitReviewVerdict).not.toHaveBeenCalled();
  });

  it('throws when script completes with null result', async () => {
    const envelope = buildStepOutputEnvelope({ result: null });
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: envelope,
      timedOut: false,
      errorMessage: null,
    });

    await expect(
      executor.execute(mockPlugin, makeContext(), services, meta),
    ).rejects.toThrow('completed with null result');
  });

  it('skips step execution persistence when no stepExecutionId', async () => {
    const envelope = buildStepOutputEnvelope({ result: { ok: true } });
    mockPluginRunner.execute.mockResolvedValue({
      resultPayload: envelope,
      timedOut: false,
      errorMessage: null,
    });

    const metaNoExec = { ...meta, stepExecutionId: undefined };
    await executor.execute(mockPlugin, makeContext(), services, metaNoExec);

    expect(mockInstanceRepo.updateStepExecution).not.toHaveBeenCalled();
  });
});
