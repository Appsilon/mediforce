// packages/platform-ui/src/lib/__tests__/execute-agent-step.test.ts
// Tests for WorkflowDefinition-native executeAgentStep
// Covers L0/L1/L2 step advancement (the fix for "stuck on first step"), L3 review routing,
// L4 autonomous execution, escalation/pause handling, and edge cases.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AgentDefinition,
  AgentOAuthToken,
  OAuthProviderConfig,
  WorkflowStep,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import {
  buildProcessInstance,
  buildAgentOutputEnvelope,
  buildWorkflowDefinition,
  InMemoryAgentOAuthTokenRepository,
  InMemoryOAuthProviderRepository,
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
  submitReviewVerdict: vi.fn(),
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
const mockAgentDefinitionRepo = {
  getById: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockToolCatalogRepo = {
  getById: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
// These two are swapped for fresh in-memory instances per test that needs
// them (see the OAuth suite below). The module-scoped defaults only have
// to exist — executeAgentStep never hits them unless step.agentId + oauth
// binding are both present, which our non-OAuth tests don't exercise.
const oauthProviderRepo = new InMemoryOAuthProviderRepository();
const agentOAuthTokenRepo = new InMemoryAgentOAuthTokenRepository();

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
    agentDefinitionRepo: mockAgentDefinitionRepo,
    toolCatalogRepo: mockToolCatalogRepo,
    oauthProviderRepo,
    agentOAuthTokenRepo,
  }),
}));

// executeAgentStep pre-fetches workflow secrets from Firestore. In unit tests
// there's no emulator and no project id, so stub the call to return an empty
// map — template resolution covers secret presence separately.
vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretsForRuntime: vi.fn().mockResolvedValue({}),
}));

// Import after mock setup
import { executeAgentStep } from '../execute-agent-step';

describe('executeAgentStep', () => {
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
      executeAgentStep('missing-id', 'gather-data', firstStep, {}, 'user-1'),
    ).rejects.toThrow('Instance not found: missing-id');
  });

  it('[ERROR] throws when WorkflowDefinition not found', async () => {
    mockProcessRepo.getWorkflowDefinition.mockResolvedValue(null);

    await expect(
      executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1'),
    ).rejects.toThrow('WorkflowDefinition not found: community-digest v1');
  });

  // ---- Plugin resolution ----

  it('[DATA] uses workflowStep.plugin for plugin lookup when set', async () => {
    const stepWithPlugin: WorkflowStep = { ...firstStep, plugin: 'custom-plugin' };

    await executeAgentStep('inst-wf-001', 'gather-data', stepWithPlugin, {}, 'user-1');

    expect(mockPluginRegistry.get).toHaveBeenCalledWith('custom-plugin');
  });

  it('[DATA] falls back to stepId for plugin lookup when plugin not set', async () => {
    await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

    expect(mockPluginRegistry.get).toHaveBeenCalledWith('gather-data');
  });

  // ---- Autonomy level resolution ----

  it('[DATA] resolves autonomy level from workflowStep', async () => {
    await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

    const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls[0][1];
    expect(contextArg.autonomyLevel).toBe('L2');
  });

  it('[DATA] defaults autonomyLevel to L2 when not set on step', async () => {
    const stepNoLevel: WorkflowStep = { id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'agent' };

    await executeAgentStep('inst-wf-001', 'gather-data', stepNoLevel, {}, 'user-1');

    const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls[0][1];
    expect(contextArg.autonomyLevel).toBe('L2');
  });

  it('[DATA] script executor always uses L4 autonomy', async () => {
    const scriptStep: WorkflowStep = {
      id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'script', autonomyLevel: 'L1',
    };

    await executeAgentStep('inst-wf-001', 'gather-data', scriptStep, {}, 'user-1');

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

        const result = await executeAgentStep('inst-wf-001', 'gather-data', step, {}, 'user-1');

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

      await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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

      await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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

      const result = await executeAgentStep('inst-wf-001', 'gather-data', l4Step, {}, 'user-1');

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
        executeAgentStep('inst-wf-001', 'gather-data', l4Step, {}, 'user-1'),
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

      await executeAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1');

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

      await executeAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1');

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

      await executeAgentStep('inst-wf-001', 'gather-data', l3WithReview, {}, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalled();
    });

    it('[DATA] L3 with review.type=agent + escalated (low_confidence) still creates HumanTask with escalationReason', async () => {
      const l3AgentReview: WorkflowStep = { ...l3Step, review: { type: 'agent' } };
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'escalated',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: 'low_confidence',
      });

      await executeAgentStep('inst-wf-001', 'gather-data', l3AgentReview, {}, 'user-1');

      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creationReason: 'agent_review_l3',
          completionData: expect.objectContaining({
            agentOutput: expect.objectContaining({
              escalationReason: 'low_confidence',
            }),
          }),
        }),
      );
    });

    it('[DATA] L3 with review.type=agent + paused (no escalation) does NOT create HumanTask', async () => {
      const l3AgentReview: WorkflowStep = { ...l3Step, review: { type: 'agent' } };
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: null,
      });

      await executeAgentStep('inst-wf-001', 'gather-data', l3AgentReview, {}, 'user-1');

      expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
    });

    it('[DATA] L3 escalated saves step execution as completed (not failed) when envelope is valid', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'escalated',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: 'low_confidence',
      });

      await executeAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1', 'exec-1');

      expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
        'inst-wf-001',
        'exec-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('[DATA] L3 + review.type=agent + non-review step + completed + appliedToWorkflow=true calls advanceStep', async () => {
      // Non-review step (type=creation) with review.type=agent falls through to
      // advanceStep — there's no verdict to submit on a creation step.
      const l3AgentReview: WorkflowStep = { ...l3Step, review: { type: 'agent' } };
      const reviewEnvelope = buildAgentOutputEnvelope({
        result: { verdict: 'approve', summary: 'LGTM' },
      });
      const runResult = {
        status: 'completed' as const,
        envelope: reviewEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      };
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue(runResult);

      await executeAgentStep('inst-wf-001', 'gather-data', l3AgentReview, {}, 'user-1');

      expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
      expect(mockEngine.submitReviewVerdict).not.toHaveBeenCalled();
      expect(mockEngine.advanceStep).toHaveBeenCalledWith(
        'inst-wf-001',
        { verdict: 'approve', summary: 'LGTM' },
        { id: 'user-1', role: 'agent' },
        undefined,
        runResult,
      );
    });

    // ---- L3 + review.type=agent on a REVIEW step: iteration loop via submitReviewVerdict ----

    const l3ReviewAgentStep: WorkflowStep = {
      id: 'review-pr',
      name: 'Review PR',
      type: 'review',
      executor: 'agent',
      autonomyLevel: 'L3',
      allowedRoles: ['senior-reviewer'],
      review: { type: 'agent', maxIterations: 3 },
    };

    it('[DATA] L3 + review.type=agent + review step + verdict=approve calls submitReviewVerdict', async () => {
      const reviewEnvelope = buildAgentOutputEnvelope({
        result: { verdict: 'approve', comment: 'LGTM' },
      });
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: reviewEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      });
      const updatedInstance = buildProcessInstance({
        id: 'inst-wf-001',
        status: 'running',
        currentStepId: 'done',
      });
      mockEngine.submitReviewVerdict.mockResolvedValue(updatedInstance);

      const result = await executeAgentStep('inst-wf-001', 'review-pr', l3ReviewAgentStep, {}, 'user-1');

      expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
      expect(mockEngine.advanceStep).not.toHaveBeenCalled();
      expect(mockEngine.submitReviewVerdict).toHaveBeenCalledWith(
        'inst-wf-001',
        'review-pr',
        expect.objectContaining({
          reviewerId: 'agent:review-pr',
          reviewerRole: 'agent',
          verdict: 'approve',
          comment: 'LGTM',
        }),
        { id: 'agent:review-pr', role: 'agent' },
      );
      expect(result.currentStepId).toBe('done');
      expect(result.agentRunStatus).toBe('completed');
    });

    it('[DATA] L3 + review.type=agent + review step + verdict=revise calls submitReviewVerdict (engine loops back)', async () => {
      const reviewEnvelope = buildAgentOutputEnvelope({
        result: { verdict: 'revise', comment: 'Please add tests' },
      });
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: reviewEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      });
      const loopedInstance = buildProcessInstance({
        id: 'inst-wf-001',
        status: 'running',
        currentStepId: 'gather-data', // looped back to creation step
      });
      mockEngine.submitReviewVerdict.mockResolvedValue(loopedInstance);

      const result = await executeAgentStep('inst-wf-001', 'review-pr', l3ReviewAgentStep, {}, 'user-1');

      expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
      expect(mockEngine.submitReviewVerdict).toHaveBeenCalledWith(
        'inst-wf-001',
        'review-pr',
        expect.objectContaining({ verdict: 'revise', comment: 'Please add tests' }),
        expect.any(Object),
      );
      expect(result.currentStepId).toBe('gather-data');
    });

    it('[DATA] L3 + review.type=agent + review step + missing verdict creates HumanTask with escalationReason=error', async () => {
      const reviewEnvelope = buildAgentOutputEnvelope({
        result: { summary: 'looks ok' }, // no verdict field
      });
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: reviewEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      });

      const result = await executeAgentStep('inst-wf-001', 'review-pr', l3ReviewAgentStep, {}, 'user-1');

      expect(mockEngine.submitReviewVerdict).not.toHaveBeenCalled();
      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creationReason: 'agent_review_l3',
          completionData: expect.objectContaining({
            agentOutput: expect.objectContaining({ escalationReason: 'error' }),
          }),
        }),
      );
      expect(result.status).toBe('paused');
      expect(result.agentRunStatus).toBe('escalated');
    });

    it('[DATA] L3 + review.type=agent + review step + max_iterations_exceeded creates HumanTask with escalationReason=iterations_limit', async () => {
      const reviewEnvelope = buildAgentOutputEnvelope({
        result: { verdict: 'revise', comment: 'still missing tests' },
      });
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'completed',
        envelope: reviewEnvelope,
        appliedToWorkflow: true,
        fallbackReason: null,
      });
      const exhaustedInstance = buildProcessInstance({
        id: 'inst-wf-001',
        status: 'paused',
        pauseReason: 'max_iterations_exceeded',
        currentStepId: 'review-pr',
      });
      mockEngine.submitReviewVerdict.mockResolvedValue(exhaustedInstance);

      const result = await executeAgentStep('inst-wf-001', 'review-pr', l3ReviewAgentStep, {}, 'user-1');

      expect(mockEngine.submitReviewVerdict).toHaveBeenCalled();
      expect(mockHumanTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creationReason: 'agent_review_l3',
          completionData: expect.objectContaining({
            agentOutput: expect.objectContaining({ escalationReason: 'iterations_limit' }),
          }),
        }),
      );
      expect(result.status).toBe('paused');
      expect(result.agentRunStatus).toBe('escalated');
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

      const result = await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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

      const result = await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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

      await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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
    await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1', 'exec-001');

    expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith('inst-wf-001', 'exec-001', expect.objectContaining({
      output: { summary: 'gathered data' },
      status: 'completed',
    }));
  });

  it('[DATA] does not call updateStepExecution when no stepExecutionId', async () => {
    await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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

    await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1');

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

    await executeAgentStep(
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

  // ---- Error-fallback must not masquerade as success ----

  describe('error-fallback step execution status', () => {
    it('[ERROR] L3 paused with fallbackReason=error marks step execution as failed, not completed', async () => {
      const l3Step: WorkflowStep = { ...firstStep, autonomyLevel: 'L3', allowedRoles: ['reviewer'] };

      // Agent runner returns paused (L3 behavior) but WITH a fallback reason (e.g. ENOENT)
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'error',
      });

      await executeAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1', 'exec-001');

      expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
        'inst-wf-001',
        'exec-001',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('[ERROR] L2 paused with fallbackReason=timeout marks step execution as failed', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'timeout',
      });

      await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1', 'exec-001');

      expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
        'inst-wf-001',
        'exec-001',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('[ERROR] escalated with fallbackReason=error marks step execution as failed', async () => {
      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'escalated',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'error',
      });

      await executeAgentStep('inst-wf-001', 'gather-data', firstStep, {}, 'user-1', 'exec-001');

      expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
        'inst-wf-001',
        'exec-001',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('[ERROR] L3 paused with fallbackReason does NOT create review HumanTask', async () => {
      const l3Step: WorkflowStep = { ...firstStep, autonomyLevel: 'L3', allowedRoles: ['reviewer'] };

      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: null,
        appliedToWorkflow: false,
        fallbackReason: 'error',
      });

      await executeAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1');

      // Should NOT create a review task — there's nothing to review, it errored
      expect(mockHumanTaskRepo.create).not.toHaveBeenCalled();
    });

    it('[DATA] paused with NO fallbackReason (normal L3) marks step execution as completed', async () => {
      const l3Step: WorkflowStep = { ...firstStep, autonomyLevel: 'L3', allowedRoles: ['reviewer'] };

      mockAgentRunner.runWithWorkflowStep.mockResolvedValue({
        status: 'paused',
        envelope: defaultEnvelope,
        appliedToWorkflow: false,
        fallbackReason: null,
      });

      await executeAgentStep('inst-wf-001', 'gather-data', l3Step, {}, 'user-1', 'exec-001');

      expect(mockInstanceRepo.updateStepExecution).toHaveBeenCalledWith(
        'inst-wf-001',
        'exec-001',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ---- Audit events ----

  it('[DATA] emits agent.step.started audit event', async () => {
    const updatedInstance = buildProcessInstance({ id: 'inst-wf-001', status: 'running' });
    mockEngine.advanceStep.mockResolvedValue(updatedInstance);

    await executeAgentStep('inst-wf-001', 'gather-data', firstStep, { topic: 'test' }, 'user-1');

    expect(mockAuditRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.step.started',
        actorId: 'agent:gather-data',
        entityId: 'inst-wf-001',
        processInstanceId: 'inst-wf-001',
      }),
    );
  });

  // ---- OAuth token loading + refresh pass-through ----
  //
  // Verifies execute-agent-step wires the binding → token repo → refresh →
  // context.oauthTokens chain end-to-end, and that near-expiry tokens get
  // refreshed + persisted before the runtime sees them.

  describe('OAuth token loading', () => {
    const agentId = 'agent-with-github';
    const namespace = 'acme';

    const omitTimestamps = (cfg: OAuthProviderConfig) => {
      const { createdAt: _c, updatedAt: _u, ...rest } = cfg;
      return rest;
    };

    const githubAgentDefinition: AgentDefinition = {
      id: agentId,
      namespace,
      name: 'GitHub agent',
      image: 'mediforce-agent:test',
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.github.com/mcp',
          auth: {
            type: 'oauth',
            provider: 'github',
            headerName: 'Authorization',
            headerValueTemplate: 'Bearer {token}',
          },
        },
      },
    };

    const githubProvider: OAuthProviderConfig = {
      id: 'github',
      name: 'GitHub',
      clientId: 'client-abc',
      clientSecret: 'secret-abc',
      authorizeUrl: 'https://example.test/authorize',
      tokenUrl: 'https://example.test/token',
      userInfoUrl: 'https://example.test/userinfo',
      scopes: ['repo'],
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
    };

    const baseToken: AgentOAuthToken = {
      provider: 'github',
      accessToken: 'gh-fresh',
      scope: 'repo',
      providerUserId: '42',
      accountLogin: '@mediforce-bot',
      connectedAt: 1_700_000_000_000,
      connectedBy: 'user-1',
    };

    const stepWithAgent: WorkflowStep = {
      id: 'run-agent',
      name: 'Run agent',
      type: 'creation',
      executor: 'agent',
      autonomyLevel: 'L2',
      agentId,
    };

    const githubWorkflow = buildWorkflowDefinition({
      name: 'gh-flow',
      version: 1,
      namespace,
      steps: [stepWithAgent, { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
      transitions: [{ from: 'run-agent', to: 'done' }],
    });

    beforeEach(() => {
      // Reset in-memory OAuth stores between tests so fixture state from one
      // test doesn't bleed into the next.
      for (const ns of ['acme', 'other']) {
        oauthProviderRepo
          .delete(ns, 'github')
          .catch(() => {});
        agentOAuthTokenRepo
          .delete(ns, agentId, 'github')
          .catch(() => {});
      }

      mockInstanceRepo.getById.mockResolvedValue(
        buildProcessInstance({
          id: 'inst-gh',
          definitionName: 'gh-flow',
          definitionVersion: '1',
          currentStepId: 'run-agent',
          status: 'running',
          configName: undefined,
          configVersion: undefined,
        }),
      );
      mockProcessRepo.getWorkflowDefinition.mockResolvedValue(githubWorkflow);
      mockAgentDefinitionRepo.getById.mockResolvedValue(githubAgentDefinition);
    });

    it('[DATA] loads oauth token and threads into context.oauthTokens', async () => {
      await oauthProviderRepo.create(namespace, omitTimestamps(githubProvider));
      await agentOAuthTokenRepo.put(namespace, agentId, 'github', baseToken);

      await executeAgentStep('inst-gh', 'run-agent', stepWithAgent, {}, 'user-1');

      const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls.at(-1)?.[1];
      expect(contextArg.oauthTokens).toEqual({
        github: {
          accessToken: 'gh-fresh',
          headerName: 'Authorization',
          headerValueTemplate: 'Bearer {token}',
        },
      });
    });

    it('[DATA] refreshes near-expiry token and persists updated token back to repo', async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: 'gh-refreshed',
            refresh_token: 'rt-new',
            expires_in: 3_600,
            scope: 'repo',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      // Patch global fetch for the provider refresh exchange. resolveOAuthToken
      // uses the injected fetchImpl when provided — but executeAgentStep calls
      // it without injection, so we patch the global for the duration of this test.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchImpl as typeof fetch;

      try {
        await oauthProviderRepo.create(namespace, {
          ...githubProvider,
          createdAt: undefined as unknown as string,
          updatedAt: undefined as unknown as string,
        });
        // Token expires within the 5min refresh margin → should refresh.
        await agentOAuthTokenRepo.put(namespace, agentId, 'github', {
          ...baseToken,
          refreshToken: 'rt-old',
          expiresAt: Date.now() + 60_000,
        });

        await executeAgentStep('inst-gh', 'run-agent', stepWithAgent, {}, 'user-1');

        // Context carries the refreshed token, not the near-expiry one.
        const contextArg = mockAgentRunner.runWithWorkflowStep.mock.calls.at(-1)?.[1];
        expect(contextArg.oauthTokens?.github?.accessToken).toBe('gh-refreshed');

        // Repo has the refreshed token persisted.
        const persisted = await agentOAuthTokenRepo.get(namespace, agentId, 'github');
        expect(persisted?.accessToken).toBe('gh-refreshed');
        expect(persisted?.refreshToken).toBe('rt-new');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('[ERROR] throws actionable error when binding requests oauth but no token is connected', async () => {
      await oauthProviderRepo.create(namespace, {
        ...githubProvider,
        createdAt: undefined as unknown as string,
        updatedAt: undefined as unknown as string,
      });
      // NOTE: No token put — simulates "binding saved, Connect never clicked".

      await expect(
        executeAgentStep('inst-gh', 'run-agent', stepWithAgent, {}, 'user-1'),
      ).rejects.toThrow(/not connected.*Connect the account via the agent editor/);
    });

    it('[ERROR] throws when provider config referenced by binding is missing', async () => {
      // Token exists, but provider doc was deleted admin-side.
      await agentOAuthTokenRepo.put(namespace, agentId, 'github', baseToken);

      await expect(
        executeAgentStep('inst-gh', 'run-agent', stepWithAgent, {}, 'user-1'),
      ).rejects.toThrow(/provider "github" .* not found/);
    });
  });
});
