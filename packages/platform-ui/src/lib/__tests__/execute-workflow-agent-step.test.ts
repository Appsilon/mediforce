// packages/platform-ui/src/lib/__tests__/execute-workflow-agent-step.test.ts
// Tests for WorkflowDefinition-native executeWorkflowAgentStep
// Covers L0/L1/L2 step advancement (the fix for "stuck on first step"), L3 review routing,
// L4 autonomous execution, escalation/pause handling, and edge cases.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowStep, WorkflowDefinition } from '@mediforce/platform-core';
import {
  buildProcessInstance,
  buildAgentOutputEnvelope,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';

// Mock platform-services module
const mockProcessRepo = {
  getWorkflowDefinition: vi.fn(),
  getProcessDefinition: vi.fn(),
  saveProcessDefinition: vi.fn(),
  saveProcessConfig: vi.fn(),
  listProcessConfigs: vi.fn(),
  setProcessArchived: vi.fn(),
  saveWorkflowDefinition: vi.fn(),
  getProcessConfig: vi.fn(),
};
const mockInstanceRepo = {
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  getByStatus: vi.fn(),
  getByDefinition: vi.fn(),
  addStepExecution: vi.fn(),
  getStepExecutions: vi.fn(),
  getLatestStepExecution: vi.fn(),
  updateStepExecution: vi.fn(),
};
const mockPluginRegistry = {
  get: vi.fn(),
  register: vi.fn(),
  has: vi.fn(),
  clear: vi.fn(),
  names: vi.fn(),
};
const mockAgentRunner = {
  runWithWorkflowStep: vi.fn(),
  run: vi.fn(),
};
const mockAuditRepo = {
  append: vi.fn(),
};
const mockEngine = {
  advanceStep: vi.fn(),
};
const mockHumanTaskRepo = {
  create: vi.fn(),
  getById: vi.fn(),
  getByRole: vi.fn(),
  getByInstanceId: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
};
const mockLlmClient = {
  complete: vi.fn(),
};

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    engine: mockEngine,
    agentRunner: mockAgentRunner,
    pluginRegistry: mockPluginRegistry,
    instanceRepo: mockInstanceRepo,
    processRepo: mockProcessRepo,
    llmClient: mockLlmClient,
    auditRepo: mockAuditRepo,
    humanTaskRepo: mockHumanTaskRepo,
  }),
}));

// Import after mock setup
import { executeWorkflowAgentStep } from '../execute-workflow-agent-step';

describe('executeWorkflowAgentStep', () => {
  const workflowDefinition: WorkflowDefinition = buildWorkflowDefinition({
    name: 'community-digest',
    version: 1,
    steps: [
      { id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
      { id: 'human-review', name: 'Human Review', type: 'review', executor: 'human', allowedRoles: ['reviewer'] },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [
      { from: 'gather-data', to: 'human-review' },
      { from: 'human-review', to: 'done' },
    ],
  });

  const defaultInstance = buildProcessInstance({
    id: 'inst-wf-001',
    definitionName: 'community-digest',
    definitionVersion: '1',
    currentStepId: 'gather-data',
    status: 'running',
    // No configName — this is a WorkflowDefinition instance
    configName: undefined,
    configVersion: undefined,
  });

  const firstStep: WorkflowStep = workflowDefinition.steps[0];

  const defaultEnvelope = buildAgentOutputEnvelope({
    result: { summary: 'gathered data' },
  });

  const mockPlugin = {
    initialize: vi.fn(),
    run: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockInstanceRepo.getById.mockResolvedValue(defaultInstance);
    mockProcessRepo.getWorkflowDefinition.mockResolvedValue(workflowDefinition);
    mockPluginRegistry.get.mockReturnValue(mockPlugin);
    mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
      status: 'completed',
      envelope: defaultEnvelope,
      appliedToWorkflow: false,
      fallbackReason: null,
    });
    mockInstanceRepo.getStepExecutions.mockResolvedValue([]);

    // Default: L0/L1/L2 completed path needs advanceStep mock
    const updatedInstance = buildProcessInstance({
      id: 'inst-wf-001',
      status: 'running',
      currentStepId: 'human-review',
    });
    mockEngine.advanceStep.mockResolvedValue(updatedInstance);
  });

  // ---- Instance & definition loading ----

  it('[ERROR] throws when instance not found', async () => {
    mockInstanceRepo.getById.mockResolvedValue(null);

    await expect(
      executeWorkflowAgentStep('missing-id', 'gather-data', firstStep, {}, 'user-1'),
    ).rejects.toThrow('Instance not found: missing-id');
  });

  it('[ERROR] throws when WorkflowDefinition not found', async () => {
    mockProcessRepo.getWorkflowDefinition.mockResolvedValue(null);

    await expect(
      executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1'),
    ).rejects.toThrow('WorkflowDefinition not found: community-digest v1');
  });

  // ---- Plugin resolution ----

  it('[DATA] uses workflowStep.plugin for plugin lookup when set', async () => {
    const stepWithPlugin: WorkflowStep = { ...firstStep, plugin: 'custom-plugin' };

    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', stepWithPlugin, {}, 'user-1');

    expect(mockPluginRegistry.get).toHaveBeenCalledWith('custom-plugin');
  });

  it('[DATA] falls back to stepId for plugin lookup when plugin not set', async () => {
    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

    expect(mockPluginRegistry.get).toHaveBeenCalledWith('gather-data');
  });

  // ---- Autonomy level resolution ----

  it('[DATA] resolves autonomy level from workflowStep', async () => {
    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

    const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls[0][1];
    expect(contextArg.autonomyLevel).toBe('L2');
  });

  it('[DATA] defaults autonomyLevel to L2 when not set on step', async () => {
    const stepNoLevel: WorkflowStep = { id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'agent' };

    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', stepNoLevel, {}, 'user-1');

    const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls[0][1];
    expect(contextArg.autonomyLevel).toBe('L2');
  });

  it('[DATA] script executor always uses L4 autonomy', async () => {
    const scriptStep: WorkflowStep = {
      id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'script', autonomyLevel: 'L1',
    };

    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', scriptStep, {}, 'user-1');

    const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls[0][1];
    expect(contextArg.autonomyLevel).toBe('L4');
  });

  // ---- L0/L1/L2 step advancement (THE FIX for "stuck on first step") ----

  describe('L0/L1/L2 step advancement', () => {
    for (const level of ['L0', 'L1', 'L2'] as const) {
      it(`[DATA] ${level} agent completion calls advanceStep`, async () => {
        const step: WorkflowStep = { ...firstStep, autonomyLevel: level };
        const updatedInstance = buildProcessInstance({
          id: 'inst-wf-001',
          status: 'paused',
          currentStepId: 'human-review',
        });
        mockEngine.advanceStep.mockResolvedValue(updatedInstance);

        const result = await executeWorkflowAgentStep('inst-wf-001', 'gather-data', step, {}, 'user-1');

        expect(mockEngine.advanceStep).toHaveBeenCalledWith(
          'inst-wf-001',
          { summary: 'gathered data' },
          { id: 'user-1', role: 'agent' },
          undefined,
        );
        expect(result.currentStepId).toBe('human-review');
        expect(result.status).toBe('paused');
      });
    }

    it('[DATA] L2 agent with null result uses empty object as stepResult', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: { ...defaultEnvelope, result: null },
        appliedToWorkflow: false,
        fallbackReason: null,
      });
      const updatedInstance = buildProcessInstance({
        id: 'inst-wf-001',
        status: 'running',
        currentStepId: 'human-review',
      });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);

      await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

      expect(mockEngine.advanceStep).toHaveBeenCalledWith(
        'inst-wf-001',
        {},
        expect.any(Object),
        undefined,
      );
    });

    it('[DATA] L2 agent with no envelope uses empty object as stepResult', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: null,
      });
      const updatedInstance = buildProcessInstance({
        id: 'inst-wf-001',
        status: 'running',
        currentStepId: 'human-review',
      });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);

      await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

      expect(mockEngine.advanceStep).toHaveBeenCalledWith(
        'inst-wf-001',
        {},
        expect.any(Object),
        undefined,
      );
    });
  });

  // ---- L4 autonomous execution ----

  describe('L4 autonomous execution', () => {
    const l4Step: WorkflowStep = { ...firstStep, autonomyLevel: 'L4' };

    it('[DATA] L4 appliedToWorkflow=true calls advanceStep with agentRunResult', async () => {
      const runResult = {
        status: 'completed' as const,
        envelope: defaultEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      };
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue(runResult);
      const updatedInstance = buildProcessInstance({
        id: 'inst-wf-001',
        status: 'running',
        currentStepId: 'human-review',
      });
      mockEngine.advanceStep.mockResolvedValue(updatedInstance);

      const result = await executeWorkflowAgentStep('inst-wf-001', 'gather-data', l4Step, {}, 'user-1');

      expect(mockEngine.advanceStep).toHaveBeenCalledWith(
        'inst-wf-001',
        { summary: 'gathered data' },
        { id: 'user-1', role: 'agent' },
        undefined,
        runResult,
      );
      expect(result.status).toBe('running');
    });

    it('[ERROR] L4 with null result throws descriptive error', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: { ...defaultEnvelope, result: null },
        appliedToWorkflow: true,
        fallbackReason: 'low_confidence',
      });

      await expect(
        executeWorkflowAgentStep('inst-wf-001', 'gather-data', l4Step, {}, 'user-1'),
      ).rejects.toThrow("completed with null result");
    });
  });

  // ---- L3 review routing ----

  describe('L3 review routing', () => {
    const l3Step: WorkflowStep = {
      ...firstStep,
      autonomyLevel: 'L3',
      allowedRoles: ['senior-reviewer'],
    };

    it('[DATA] L3 paused creates HumanTask for review', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: null,
      });

      await executeWorkflowAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          processInstanceId: 'inst-wf-001',
          stepId: 'gather-data',
          assignedRole: 'senior-reviewer',
          status: 'pending',
          completionData: expect.objectContaining({
            reviewType: 'agent_output_review',
            agentOutput: expect.objectContaining({
              confidence: defaultEnvelope.confidence,
              reasoning: defaultEnvelope.reasoning_summary,
              result: defaultEnvelope.result,
            }),
          }),
          creationReason: 'agent_review_l3',
        }),
      );
    });

    it('[DATA] L3 escalated also creates HumanTask', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'escalated',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: 'low_confidence',
      });

      await executeWorkflowAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creationReason: 'agent_review_l3',
        }),
      );
    });

    it('[DATA] L3 with review.type=human creates HumanTask', async () => {
      const l3WithReview: WorkflowStep = { ...l3Step, review: { type: 'human' } };
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: null,
      });

      await executeWorkflowAgentStep('inst-wf-001', 'gather-data', l3WithReview, {}, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalled();
    });
  });

  // ---- Escalation/Pause (non-L3) ----

  describe('escalation and pause for non-L3', () => {
    it('[DATA] escalated L2 agent does NOT call advanceStep', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'escalated',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'error',
      });

      const result = await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

      expect(mockEngine.advanceStep).not.toHaveBeenCalled();
      expect(result.agentRunStatus).toBe('escalated');
    });

    it('[DATA] paused L2 agent does NOT call advanceStep', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'timeout',
      });

      const result = await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

      expect(mockEngine.advanceStep).not.toHaveBeenCalled();
      expect(result.agentRunStatus).toBe('paused');
    });

    it('[DATA] escalation audit event includes fallback reason', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'escalated',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'low_confidence',
      });

      await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

      // Second audit call is the escalation event (first is agent.step.started)
      const escalationAudit = mockAuditRepo.append.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).action === 'agent.escalated',
      );
      expect(escalationAudit).toBeDefined();
      expect((escalationAudit![0] as Record<string, unknown>).inputSnapshot).toEqual(
        expect.objectContaining({ fallbackReason: 'low_confidence' }),
      );
    });
  });

  // ---- Step execution persistence ----

  it('[DATA] persists agent output to step execution when stepExecutionId provided', async () => {
    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1', 'exec-001');

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith('inst-wf-001', 'exec-001', expect.objectContaining({
      output: { summary: 'gathered data' },
      status: 'completed',
    }));
  });

  it('[DATA] does not call updateStepExecution when no stepExecutionId', async () => {
    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

    expect(mockInstanceRepo.updateStepExecution).not.toHaveBeenCalled();
  });

  // ---- Output persistence to instance.variables ----

  it('[DATA] persists agent output to instance.variables for subsequent steps', async () => {
    // After the agent runs, getById is called again to merge variables
    mockInstanceRepo.getById
      .mockResolvedValueOnce(defaultInstance) // initial load
      .mockResolvedValueOnce(defaultInstance); // for variable merge

    const updatedInstance = buildProcessInstance({ id: 'inst-wf-001', status: 'running', currentStepId: 'human-review' });
    mockEngine.advanceStep.mockResolvedValue(updatedInstance);

    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

    expect(mockInstanceRepo.update).toHaveBeenCalledWith('inst-wf-001', {
      variables: expect.objectContaining({
        'gather-data': { summary: 'gathered data' },
      }),
    });
  });

  // ---- stepParams merging ----

  it('[DATA] merges stepParams with appContext (appContext wins on conflict)', async () => {
    const stepWithParams: WorkflowStep = {
      ...firstStep,
      stepParams: { defaultParam: 'from-step', shared: 'step-value' },
    };

    const updatedInstance = buildProcessInstance({ id: 'inst-wf-001', status: 'running' });
    mockEngine.advanceStep.mockResolvedValue(updatedInstance);

    await executeWorkflowAgentStep(
      'inst-wf-001', 'gather-data', stepWithParams,
      { shared: 'app-value', extra: 'from-app' },
      'user-1',
    );

    const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls[0][1];
    expect(contextArg.stepInput).toEqual({
      defaultParam: 'from-step',
      shared: 'app-value', // appContext wins
      extra: 'from-app',
    });
  });

  // ---- Audit events ----

  it('[DATA] emits agent.step.started audit event', async () => {
    const updatedInstance = buildProcessInstance({ id: 'inst-wf-001', status: 'running' });
    mockEngine.advanceStep.mockResolvedValue(updatedInstance);

    await executeWorkflowAgentStep('inst-wf-001', 'gather-data', firstStep, { topic: 'test' }, 'user-1');

    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.step.started',
        actorId: 'agent:gather-data',
        entityId: 'inst-wf-001',
        processInstanceId: 'inst-wf-001',
      }),
    );
  });
});
