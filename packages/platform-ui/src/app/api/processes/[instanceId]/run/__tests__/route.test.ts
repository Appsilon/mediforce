// Tests for the auto-runner loop (/api/processes/[instanceId]/run)
// Covers the "stuck on first step" bug and workflow execution flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockInstanceGetById = vi.fn();
const mockInstanceUpdate = vi.fn();
const mockInstanceAddStepExecution = vi.fn();
const mockAuditAppend = vi.fn();
const mockGetWorkflowDefinition = vi.fn();
const mockGetProcessDefinition = vi.fn();
const mockGetProcessConfig = vi.fn();
const mockHumanTaskCreate = vi.fn();
const mockHumanTaskGetByInstanceId = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: {
      getById: mockInstanceGetById,
      update: mockInstanceUpdate,
      addStepExecution: mockInstanceAddStepExecution,
    },
    processRepo: {
      getWorkflowDefinition: mockGetWorkflowDefinition,
      getProcessDefinition: mockGetProcessDefinition,
      getProcessConfig: mockGetProcessConfig,
    },
    auditRepo: { append: mockAuditAppend },
    humanTaskRepo: {
      create: mockHumanTaskCreate,
      getByInstanceId: mockHumanTaskGetByInstanceId,
    },
  }),
  validateApiKey: () => true,
}));

// Mock executeWorkflowAgentStep — this is what advances the step
const mockExecuteWorkflowAgentStep = vi.fn();
vi.mock('@/lib/execute-agent-step', () => ({
  executeWorkflowAgentStep: (...args: unknown[]) => mockExecuteWorkflowAgentStep(...args),
}));

// Mock executeAgentStep for legacy path
const mockExecuteAgentStep = vi.fn();
vi.mock('@/lib/execute-agent-step', () => ({
  executeAgentStep: (...args: unknown[]) => mockExecuteAgentStep(...args),
}));

import { POST } from '../route';

// ---- Helpers ----

const makeParams = (instanceId: string) => Promise.resolve({ instanceId });

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/processes/inst-1/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });
}

// ---- Test data ----

const workflowDefinition = {
  name: 'community-digest',
  version: 1,
  steps: [
    { id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
    { id: 'human-review', name: 'Human Review', type: 'creation', executor: 'human', allowedRoles: ['reviewer'] },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'gather-data', to: 'human-review' },
    { from: 'human-review', to: 'done' },
  ],
};

// ---- Tests ----

describe('POST /api/processes/[instanceId]/run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHumanTaskGetByInstanceId.mockResolvedValue([]);
  });

  describe('workflow instance (no configName)', () => {
    it('[DATA] first agent step completes and advances to human step — no stuck loop', async () => {
      // Iteration 1: instance at first step (agent)
      // After executeWorkflowAgentStep, instance moves to human-review and pauses
      let callCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // First two calls: instance at first step, running
          return Promise.resolve({
            id: 'inst-1',
            definitionName: 'community-digest',
            definitionVersion: '1',
            status: 'running',
            currentStepId: 'gather-data',
            configName: undefined,
            variables: {},
            triggerPayload: {},
          });
        }
        // After agent step executes: instance moved to human-review and paused
        return Promise.resolve({
          id: 'inst-1',
          definitionName: 'community-digest',
          definitionVersion: '1',
          status: 'paused',
          currentStepId: 'human-review',
          configName: undefined,
          variables: { 'gather-data': { result: 'done' } },
          triggerPayload: {},
        });
      });

      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockExecuteWorkflowAgentStep.mockResolvedValue({
        instanceId: 'inst-1',
        status: 'paused',
        currentStepId: 'human-review',
        agentRunStatus: 'completed',
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      const json = await res.json();

      // Agent step should have been executed exactly once
      expect(mockExecuteWorkflowAgentStep).toHaveBeenCalledTimes(1);
      // Instance should end paused (waiting for human)
      expect(json.status).toBe('paused');
      expect(json.stepsExecuted).toBe(1);
    });

    it('[ERROR] stuck loop safety guard triggers after MAX_SAME_STEP_ITERATIONS', async () => {
      // Simulate: agent step runs but instance stays at same step (the old bug)
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1',
        definitionName: 'community-digest',
        definitionVersion: '1',
        status: 'running',
        currentStepId: 'gather-data',
        configName: undefined,
        variables: {},
        triggerPayload: {},
      });

      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockExecuteWorkflowAgentStep.mockResolvedValue({
        instanceId: 'inst-1',
        status: 'running',
        currentStepId: 'gather-data', // Stuck! Same step
        agentRunStatus: 'completed',
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      const json = await res.json();

      // Should fail the instance after detecting stuck loop
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('looped'),
      }));
      // Agent should have been called at most 2 times (first call doesn't count as stuck,
      // second call increments to 1, third call at count=2 would trigger, but isStuckLoop
      // is checked BEFORE execution so it runs 2 times then detects on 3rd check)
      expect(mockExecuteWorkflowAgentStep.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('[DATA] first step is human — creates task and pauses without executing agent', async () => {
      const humanFirstWorkflow = {
        ...workflowDefinition,
        steps: [
          { id: 'fill-form', name: 'Fill Form', type: 'creation', executor: 'human', allowedRoles: ['operator'] },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'fill-form', to: 'done' }],
      };

      mockInstanceGetById.mockImplementation(() =>
        Promise.resolve({
          id: 'inst-1',
          definitionName: 'community-digest',
          definitionVersion: '1',
          status: 'running',
          currentStepId: 'fill-form',
          configName: undefined,
          variables: {},
          triggerPayload: {},
        }),
      );

      mockGetWorkflowDefinition.mockResolvedValue(humanFirstWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      const json = await res.json();

      // No agent step should have been called
      expect(mockExecuteWorkflowAgentStep).not.toHaveBeenCalled();
      // Human task should have been created
      expect(mockHumanTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        stepId: 'fill-form',
        assignedRole: 'operator',
        status: 'pending',
        creationReason: 'human_executor',
      }));
      // Instance should be paused
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'paused',
        pauseReason: 'waiting_for_human',
      }));
    });

    it('[DATA] chained agent steps execute in sequence until human step', async () => {
      const chainedWorkflow = {
        ...workflowDefinition,
        steps: [
          { id: 'step-1', name: 'Step 1', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
          { id: 'step-2', name: 'Step 2', type: 'creation', executor: 'agent', autonomyLevel: 'L4' },
          { id: 'human-review', name: 'Human Review', type: 'creation', executor: 'human', allowedRoles: ['reviewer'] },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [
          { from: 'step-1', to: 'step-2' },
          { from: 'step-2', to: 'human-review' },
          { from: 'human-review', to: 'done' },
        ],
      };

      let agentCallCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        // Simulate step progression
        if (agentCallCount === 0) {
          return Promise.resolve({
            id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
            status: 'running', currentStepId: 'step-1', configName: undefined, variables: {}, triggerPayload: {},
          });
        }
        if (agentCallCount === 1) {
          return Promise.resolve({
            id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
            status: 'running', currentStepId: 'step-2', configName: undefined,
            variables: { 'step-1': { result: 'ok' } }, triggerPayload: {},
          });
        }
        // After step-2: paused at human-review
        return Promise.resolve({
          id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
          status: 'paused', currentStepId: 'human-review', configName: undefined,
          variables: { 'step-1': { result: 'ok' }, 'step-2': { result: 'ok' } }, triggerPayload: {},
        });
      });

      mockGetWorkflowDefinition.mockResolvedValue(chainedWorkflow);
      mockExecuteWorkflowAgentStep.mockImplementation(() => {
        agentCallCount++;
        return Promise.resolve({
          instanceId: 'inst-1',
          status: agentCallCount >= 2 ? 'paused' : 'running',
          currentStepId: agentCallCount >= 2 ? 'human-review' : 'step-2',
          agentRunStatus: 'completed',
        });
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      const json = await res.json();

      // Both agent steps should have been executed
      expect(mockExecuteWorkflowAgentStep).toHaveBeenCalledTimes(2);
      expect(json.stepsExecuted).toBe(2);
      expect(json.status).toBe('paused');
    });

    it('[DATA] terminal step as first step — loop exits immediately', async () => {
      const terminalFirstWorkflow = {
        ...workflowDefinition,
        steps: [
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [],
      };

      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'done', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(terminalFirstWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      const json = await res.json();

      expect(mockExecuteWorkflowAgentStep).not.toHaveBeenCalled();
      expect(json.stepsExecuted).toBe(0);
    });

    it('[ERROR] unknown step ID fails the instance', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'nonexistent-step', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });

      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('Unknown step'),
      }));
    });

    it('[ERROR] unknown executor type fails the instance', async () => {
      const badWorkflow = {
        ...workflowDefinition,
        steps: [
          { id: 'gather-data', name: 'Gather Data', type: 'creation', executor: 'robot' as string },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
      };

      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'gather-data', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(badWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });

      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining("Unknown executor 'robot'"),
      }));
    });

    it('[DATA] duplicate guard: skips if pending task already exists for step', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'gather-data', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockHumanTaskGetByInstanceId.mockResolvedValue([
        { stepId: 'gather-data', status: 'pending' },
      ]);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });

      // Should not execute the agent step
      expect(mockExecuteWorkflowAgentStep).not.toHaveBeenCalled();
      // Should pause the instance
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'paused',
        pauseReason: 'waiting_for_human',
      }));
    });
  });

  describe('basic guards', () => {
    it('[ERROR] returns 404 when instance not found', async () => {
      mockInstanceGetById.mockResolvedValue(null);

      const res = await POST(makeRequest(), { params: makeParams('inst-999') });

      expect(res.status).toBe(404);
    });

    it('[ERROR] returns 409 when instance is not running', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', status: 'completed', configName: 'default',
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });

      expect(res.status).toBe(409);
    });
  });
});
