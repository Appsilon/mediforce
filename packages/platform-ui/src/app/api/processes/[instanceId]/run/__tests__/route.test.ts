// Tests for the auto-runner loop (/api/processes/[instanceId]/run)
// Covers the "stuck on first step" bug and workflow execution flow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock next/server `after()` to capture the callback so tests can await it
let afterCallback: (() => Promise<void>) | null = null;
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return {
    ...mod,
    after: (fn: () => Promise<void>) => { afterCallback = fn; },
  };
});

// ---- Mocks ----

const mockInstanceGetById = vi.fn();
const mockInstanceUpdate = vi.fn();
const mockInstanceAddStepExecution = vi.fn();
const mockInstanceUpdateStepExecution = vi.fn();
const mockGetStepExecutions = vi.fn();
const mockAuditAppend = vi.fn();
const mockGetWorkflowDefinition = vi.fn();
const mockGetProcessDefinition = vi.fn();
const mockGetProcessConfig = vi.fn();
const mockGetLatestWorkflowVersion = vi.fn();
const mockHumanTaskCreate = vi.fn();
const mockResolveUser = vi.fn();
const mockHumanTaskGetByInstanceId = vi.fn();
const mockCoworkSessionCreate = vi.fn();
const mockCoworkSessionGetByInstanceId = vi.fn();
const mockFireWorkflow = vi.fn();
const mockAdvanceStep = vi.fn();

const mockActionDispatch = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: {
      getById: mockInstanceGetById,
      update: mockInstanceUpdate,
      addStepExecution: mockInstanceAddStepExecution,
      updateStepExecution: mockInstanceUpdateStepExecution,
      getStepExecutions: (...args: unknown[]) => mockGetStepExecutions(...args),
    },
    processRepo: {
      getWorkflowDefinition: mockGetWorkflowDefinition,
      getProcessDefinition: mockGetProcessDefinition,
      getProcessConfig: mockGetProcessConfig,
      getLatestWorkflowVersion: mockGetLatestWorkflowVersion,
    },
    auditRepo: { append: mockAuditAppend },
    humanTaskRepo: {
      create: mockHumanTaskCreate,
      getByInstanceId: mockHumanTaskGetByInstanceId,
    },
    coworkSessionRepo: {
      create: mockCoworkSessionCreate,
      getByInstanceId: mockCoworkSessionGetByInstanceId,
    },
    agentDefinitionRepo: {
      getById: vi.fn().mockResolvedValue(null),
    },
    toolCatalogRepo: {
      getById: vi.fn().mockResolvedValue(null),
    },
    namespaceRepo: {},
    userDirectory: { resolveUser: (...args: unknown[]) => mockResolveUser(...args) },
    pluginRegistry: { list: vi.fn().mockReturnValue([]) },
    modelRegistryRepo: { list: vi.fn().mockResolvedValue([]) },
    actionRegistry: { dispatch: mockActionDispatch },
    engine: { advanceStep: (...args: unknown[]) => mockAdvanceStep(...args) },
  }),
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

// Mock executeAgentStep — the unified agent step executor
const mockExecuteAgentStep = vi.fn();
vi.mock('@/lib/execute-agent-step', () => ({
  executeAgentStep: (...args: unknown[]) => mockExecuteAgentStep(...args),
}));

// Pre-flight in the route fetches workflow secrets from Firestore. In unit
// tests we have no emulator and no project id, so we stub the call to return
// an empty map — template validation covers secret presence separately.
vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretsForRuntime: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/app/actions/namespace-secrets', () => ({
  getNamespaceSecretsForRuntime: vi.fn().mockResolvedValue({}),
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
  namespace: 'test',
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
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    afterCallback = null;
    mockHumanTaskGetByInstanceId.mockResolvedValue([]);
    mockCoworkSessionGetByInstanceId.mockResolvedValue([]);
    mockGetStepExecutions.mockResolvedValue([]);
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
            namespace: 'test-ns',
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
          namespace: 'test-ns',
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
      mockExecuteAgentStep.mockResolvedValue({
        instanceId: 'inst-1',
        status: 'paused',
        currentStepId: 'human-review',
        agentRunStatus: 'completed',
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);

      // Execute the after() callback (long-running work)
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      // Agent step should have been executed exactly once
      expect(mockExecuteAgentStep).toHaveBeenCalledTimes(1);
      // Step execution recorded for that one step (was: json.stepsExecuted === 1
      // before the after() refactor dropped the response body)
      expect(mockInstanceAddStepExecution).toHaveBeenCalledTimes(1);
      expect(mockInstanceAddStepExecution).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining({ stepId: 'gather-data', status: 'running' }),
      );
    });

    it('[DATA] reaps a stranded running step past its timeout instead of re-running it (issue #868)', async () => {
      let callCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        callCount++;
        const base = {
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
          definitionVersion: '1', configName: undefined, variables: {}, triggerPayload: {},
        };
        // Initial check + first loop read see `running`; after the reap the
        // instance is paused (escalated), so the loop exits.
        return Promise.resolve(callCount <= 2
          ? { ...base, status: 'running', currentStepId: 'gather-data' }
          : { ...base, status: 'paused', currentStepId: 'gather-data' });
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockGetStepExecutions.mockResolvedValue([
        { id: 'exec-stranded', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 40 * 60_000).toISOString() },
      ]);
      mockExecuteAgentStep.mockResolvedValue({
        instanceId: 'inst-1', status: 'paused', currentStepId: 'gather-data', agentRunStatus: 'escalated',
      });

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      expect(mockExecuteAgentStep).toHaveBeenCalledWith(
        'inst-1', 'gather-data', expect.objectContaining({ id: 'gather-data' }),
        expect.anything(), expect.any(String), 'exec-stranded', { reapTimedOut: true },
      );
      // No fresh execution row created — the stranded one is reaped, not re-run.
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
    });

    it('[DATA] defers a running step not yet past its timeout to the heartbeat — no double-run (issue #868)', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
        definitionVersion: '1', status: 'running', currentStepId: 'gather-data',
        configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockGetStepExecutions.mockResolvedValue([
        { id: 'exec-fresh', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 2 * 60_000).toISOString() },
      ]);

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      expect(mockExecuteAgentStep).not.toHaveBeenCalled();
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
    });

    it('[DATA] reaps every in-flight row when multiple executions are stranded past their timeout (issue #868)', async () => {
      let callCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        callCount++;
        const base = {
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
          definitionVersion: '1', configName: undefined, variables: {}, triggerPayload: {},
        };
        // Initial check + first loop read see `running`; after the reap the
        // instance is paused (escalated), so the loop exits.
        return Promise.resolve(callCount <= 2
          ? { ...base, status: 'running', currentStepId: 'gather-data' }
          : { ...base, status: 'paused', currentStepId: 'gather-data' });
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockGetStepExecutions.mockResolvedValue([
        { id: 'exec-stranded-a', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 40 * 60_000).toISOString() },
        { id: 'exec-stranded-b', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 50 * 60_000).toISOString() },
      ]);
      mockExecuteAgentStep.mockResolvedValue({
        instanceId: 'inst-1', status: 'paused', currentStepId: 'gather-data', agentRunStatus: 'escalated',
      });

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      // Both stranded rows reaped — neither left showing running forever.
      expect(mockExecuteAgentStep).toHaveBeenCalledTimes(2);
      expect(mockExecuteAgentStep).toHaveBeenCalledWith(
        'inst-1', 'gather-data', expect.objectContaining({ id: 'gather-data' }),
        expect.anything(), expect.any(String), 'exec-stranded-a', { reapTimedOut: true },
      );
      expect(mockExecuteAgentStep).toHaveBeenCalledWith(
        'inst-1', 'gather-data', expect.objectContaining({ id: 'gather-data' }),
        expect.anything(), expect.any(String), 'exec-stranded-b', { reapTimedOut: true },
      );
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
    });

    it('[DATA] defers when a live attempt runs alongside a stranded row — reaps nothing (issue #868)', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
        definitionVersion: '1', status: 'running', currentStepId: 'gather-data',
        configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      // One overdue row and one live (not-yet-overdue) attempt for the same step.
      mockGetStepExecutions.mockResolvedValue([
        { id: 'exec-stranded', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 40 * 60_000).toISOString() },
        { id: 'exec-live', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 2 * 60_000).toISOString() },
      ]);

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      // A live attempt exists — defer wholesale, reap nothing, dispatch nothing.
      expect(mockExecuteAgentStep).not.toHaveBeenCalled();
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
    });

    it('[DATA] advances past a continue_with_flag reap instead of re-dispatching the timed-out step (issue #868)', async () => {
      let callCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        callCount++;
        const base = {
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
          definitionVersion: '1', configName: undefined, variables: {}, triggerPayload: {},
        };
        // Reap + afterReap read the run still `running` on the same step
        // (continue_with_flag leaves it there). Once advanced, the loop lands on
        // the terminal step and exits.
        return Promise.resolve(callCount <= 3
          ? { ...base, status: 'running', currentStepId: 'gather-data' }
          : { ...base, status: 'running', currentStepId: 'done' });
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockGetStepExecutions.mockResolvedValue([
        { id: 'exec-stranded', stepId: 'gather-data', status: 'running', startedAt: new Date(Date.now() - 40 * 60_000).toISOString() },
      ]);
      // executeAgentStep (reap) does not move the instance off the step — mirrors
      // the continue_with_flag fallback returning status 'flagged'.
      mockExecuteAgentStep.mockResolvedValue({
        instanceId: 'inst-1', status: 'running', currentStepId: 'gather-data', agentRunStatus: 'flagged',
      });

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      // Reaped once, then advanced past the flagged step — no fresh attempt.
      expect(mockExecuteAgentStep).toHaveBeenCalledTimes(1);
      expect(mockExecuteAgentStep).toHaveBeenCalledWith(
        'inst-1', 'gather-data', expect.objectContaining({ id: 'gather-data' }),
        expect.anything(), expect.any(String), 'exec-stranded', { reapTimedOut: true },
      );
      expect(mockAdvanceStep).toHaveBeenCalledWith('inst-1', {}, { id: 'auto-runner', role: 'system' });
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
    });

    it('[DATA] retries a deploy-interrupted step as a fresh attempt, not a timeout reap (issue #907)', async () => {
      let callCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        callCount++;
        const base = {
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
          definitionVersion: '1', configName: undefined, variables: {}, triggerPayload: {},
        };
        // Initial check + first loop read see `running` on the step; after the
        // fresh attempt the run pauses at the human step so the loop exits.
        return Promise.resolve(callCount <= 2
          ? { ...base, status: 'running', currentStepId: 'gather-data' }
          : { ...base, status: 'paused', currentStepId: 'human-review' });
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      // The prior execution was marked `interrupted` by the SIGTERM hook — no
      // running row remains. Started long ago, so under the reap logic this
      // would be past its timeout; the retry branch must ignore that and NOT
      // route it through the timeout reap.
      mockGetStepExecutions.mockResolvedValue([
        { id: 'exec-interrupted', stepId: 'gather-data', status: 'interrupted', startedAt: new Date(Date.now() - 40 * 60_000).toISOString() },
      ]);
      mockExecuteAgentStep.mockResolvedValue({
        instanceId: 'inst-1', status: 'paused', currentStepId: 'human-review', agentRunStatus: 'completed',
      });

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      // A brand-new execution row is created (fresh attempt) — the interrupted
      // row is left as a historical record, not reaped.
      expect(mockInstanceAddStepExecution).toHaveBeenCalledTimes(1);
      expect(mockInstanceAddStepExecution).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining({ stepId: 'gather-data', status: 'running' }),
      );
      // executeAgentStep is called for a fresh run (no reapTimedOut option), and
      // never with the interrupted row's id under reap mode.
      expect(mockExecuteAgentStep).toHaveBeenCalledTimes(1);
      expect(mockExecuteAgentStep).not.toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), expect.anything(), 'exec-interrupted', { reapTimedOut: true },
      );
      const [, , , , , freshExecId, reapOpts] = mockExecuteAgentStep.mock.calls[0];
      expect(freshExecId).not.toBe('exec-interrupted');
      expect(reapOpts).toBeUndefined();
    });

    it('[DATA] fails the run when a step exceeds the persisted attempt cap (issue #868)', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest',
        definitionVersion: '1', status: 'running', currentStepId: 'gather-data',
        configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      // 10 prior completed attempts of the same step, none still running.
      mockGetStepExecutions.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `exec-${i}`, stepId: 'gather-data', status: 'completed',
          startedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
        })),
      );

      await POST(makeRequest(), { params: makeParams('inst-1') });
      await afterCallback!();

      expect(mockExecuteAgentStep).not.toHaveBeenCalled();
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('exceeded'),
      }));
    });

    it('[ERROR] stuck loop safety guard triggers after MAX_SAME_STEP_ITERATIONS', async () => {
      // Simulate: agent step runs but instance stays at same step (the old bug)
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1',
        namespace: 'test-ns',
        definitionName: 'community-digest',
        definitionVersion: '1',
        status: 'running',
        currentStepId: 'gather-data',
        configName: undefined,
        variables: {},
        triggerPayload: {},
      });

      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockExecuteAgentStep.mockResolvedValue({
        instanceId: 'inst-1',
        status: 'running',
        currentStepId: 'gather-data', // Stuck! Same step
        agentRunStatus: 'completed',
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      // Should fail the instance after detecting stuck loop
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('looped'),
      }));
      // Agent should have been called at most 2 times (first call doesn't count as stuck,
      // second call increments to 1, third call at count=2 would trigger, but isStuckLoop
      // is checked BEFORE execution so it runs 2 times then detects on 3rd check)
      expect(mockExecuteAgentStep.mock.calls.length).toBeLessThanOrEqual(3);
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
          namespace: 'test-ns',
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
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      // No agent step should have been called
      expect(mockExecuteAgentStep).not.toHaveBeenCalled();
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
            id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
            status: 'running', currentStepId: 'step-1', configName: undefined, variables: {}, triggerPayload: {},
          });
        }
        if (agentCallCount === 1) {
          return Promise.resolve({
            id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
            status: 'running', currentStepId: 'step-2', configName: undefined,
            variables: { 'step-1': { result: 'ok' } }, triggerPayload: {},
          });
        }
        // After step-2: paused at human-review
        return Promise.resolve({
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
          status: 'paused', currentStepId: 'human-review', configName: undefined,
          variables: { 'step-1': { result: 'ok' }, 'step-2': { result: 'ok' } }, triggerPayload: {},
        });
      });

      mockGetWorkflowDefinition.mockResolvedValue(chainedWorkflow);
      mockExecuteAgentStep.mockImplementation(() => {
        agentCallCount++;
        return Promise.resolve({
          instanceId: 'inst-1',
          status: agentCallCount >= 2 ? 'paused' : 'running',
          currentStepId: agentCallCount >= 2 ? 'human-review' : 'step-2',
          agentRunStatus: 'completed',
        });
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      // Both agent steps should have been executed
      expect(mockExecuteAgentStep).toHaveBeenCalledTimes(2);
      // Step execution recorded for both steps (was: json.stepsExecuted === 2
      // before the after() refactor dropped the response body)
      expect(mockInstanceAddStepExecution).toHaveBeenCalledTimes(2);
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
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'done', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(terminalFirstWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockExecuteAgentStep).not.toHaveBeenCalled();
      // No step execution recorded — terminal exits before any work (was:
      // json.stepsExecuted === 0 before the after() refactor)
      expect(mockInstanceAddStepExecution).not.toHaveBeenCalled();
    });

    it('[DATA] cowork step resolves workflow schema ref when creating the session', async () => {
      const coworkWorkflow = {
        ...workflowDefinition,
        steps: [
          {
            id: 'design',
            name: 'Design',
            type: 'creation',
            executor: 'cowork',
            allowedRoles: ['workflow-designer'],
            cowork: {
              agent: 'chat',
              outputSchemaRef: 'workflow-definition-authorable',
            },
          },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'design', to: 'done' }],
      };

      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'design', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(coworkWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockCoworkSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
        stepId: 'design',
        outputSchema: expect.objectContaining({
          type: 'object',
          required: expect.arrayContaining(['name', 'steps', 'transitions', 'triggers']),
          properties: expect.objectContaining({
            name: expect.objectContaining({ type: 'string' }),
            steps: expect.objectContaining({ type: 'array' }),
          }),
        }),
      }));
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'paused',
        pauseReason: 'cowork_in_progress',
      }));
    });

    it('[ERROR] unknown step ID fails the instance', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'nonexistent-step', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

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
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'gather-data', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(badWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining("Unknown executor 'robot'"),
      }));
    });

    it('[DATA] duplicate guard: skips if pending task already exists for step', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
        status: 'running', currentStepId: 'gather-data', configName: undefined, variables: {}, triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(workflowDefinition);
      mockHumanTaskGetByInstanceId.mockResolvedValue([
        { stepId: 'gather-data', status: 'pending' },
      ]);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      // Should not execute the agent step
      expect(mockExecuteAgentStep).not.toHaveBeenCalled();
      // Should pause the instance
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'paused',
        pauseReason: 'waiting_for_human',
      }));
    });
  });

  describe('action executor: spawn fan-out', () => {
    const spawnWorkflow = {
      name: 'team-pulse',
      version: 1,
      namespace: 'test-ns',
      steps: [
        {
          id: 'dispatch',
          name: 'Dispatch',
          type: 'creation',
          executor: 'action',
          action: {
            kind: 'spawn',
            config: {
              forEach: '${steps.prepare.teamMembers}',
              targets: {
                definitionName: 'gather-perspective',
                payload: { userId: '${item.userId}', email: '${item.email}' },
              },
              continueOnSpawnError: true,
            },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'dispatch', to: 'done' }],
    };

    it('[DATA] spawn action dispatches one child workflow per forEach item', async () => {
      const teamMembers = [
        { userId: 'alice', email: 'alice@test.com' },
        { userId: 'bob', email: 'bob@test.com' },
        { userId: 'carol', email: 'carol@test.com' },
      ];

      let callCount = 0;
      mockInstanceGetById.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            id: 'inst-1', namespace: 'test-ns', definitionName: 'team-pulse', definitionVersion: '1',
            status: 'running', currentStepId: 'dispatch', configName: undefined,
            variables: { prepare: { teamMembers } },
            triggerPayload: {},
          });
        }
        return Promise.resolve({
          id: 'inst-1', namespace: 'test-ns', definitionName: 'team-pulse', definitionVersion: '1',
          status: 'completed', currentStepId: null, configName: undefined,
          variables: { prepare: { teamMembers }, dispatch: { spawnedCount: 3 } },
          triggerPayload: {},
        });
      });

      mockGetWorkflowDefinition.mockResolvedValue(spawnWorkflow);

      const spawnOutput = {
        spawned: [
          { instanceId: 'child-1', definitionName: 'gather-perspective', definitionVersion: 2, status: 'created', itemIndex: 0 },
          { instanceId: 'child-2', definitionName: 'gather-perspective', definitionVersion: 2, status: 'created', itemIndex: 1 },
          { instanceId: 'child-3', definitionName: 'gather-perspective', definitionVersion: 2, status: 'created', itemIndex: 2 },
        ],
        errors: [],
        spawnedCount: 3,
        errorCount: 0,
      };
      mockActionDispatch.mockResolvedValue(spawnOutput);
      mockAdvanceStep.mockResolvedValue({ id: 'inst-1', status: 'completed' });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockActionDispatch).toHaveBeenCalledTimes(1);
      expect(mockActionDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'spawn',
          config: expect.objectContaining({
            forEach: '${steps.prepare.teamMembers}',
            targets: expect.objectContaining({ definitionName: 'gather-perspective' }),
          }),
        }),
        expect.objectContaining({
          stepId: 'dispatch',
          processInstanceId: 'inst-1',
          namespace: 'test-ns',
          sources: expect.objectContaining({
            steps: expect.objectContaining({
              prepare: expect.objectContaining({ teamMembers }),
            }),
          }),
        }),
      );

      expect(mockInstanceUpdateStepExecution).toHaveBeenCalledWith(
        'inst-1',
        expect.any(String),
        expect.objectContaining({
          status: 'completed',
          output: expect.objectContaining({ spawnedCount: 3, errorCount: 0 }),
        }),
      );

      expect(mockAdvanceStep).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining({ spawnedCount: 3 }),
        expect.objectContaining({ id: 'auto-runner' }),
      );
    });
  });

  describe('action executor: wait', () => {
    const waitWorkflow = {
      name: 'team-pulse',
      version: 1,
      namespace: 'test-ns',
      steps: [
        {
          id: 'pause',
          name: 'Pause',
          type: 'creation',
          executor: 'action',
          action: { kind: 'wait', config: { duration: { hours: 1 } } },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'pause', to: 'done' }],
    };

    it('[DATA] wait sentinel pauses the instance without completing the step or advancing', async () => {
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1', namespace: 'test-ns', definitionName: 'team-pulse', definitionVersion: '1',
        status: 'running', currentStepId: 'pause', configName: undefined,
        variables: {},
        triggerPayload: {},
      });
      mockGetWorkflowDefinition.mockResolvedValue(waitWorkflow);

      const waitSentinel = {
        __wait: {
          stepId: 'pause',
          resumeAt: '2026-06-01T13:00:00.000Z',
          pausedAt: '2026-06-01T12:00:00.000Z',
          mode: 'duration',
        },
      };
      mockActionDispatch.mockResolvedValue(waitSentinel);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      // Step execution recorded as paused with no output — the resolved output
      // only materialises on resume (write-once), never the raw sentinel.
      expect(mockInstanceUpdateStepExecution).toHaveBeenCalledWith(
        'inst-1',
        expect.any(String),
        expect.objectContaining({ status: 'paused', output: null }),
      );
      expect(mockInstanceUpdateStepExecution).not.toHaveBeenCalledWith(
        'inst-1',
        expect.any(String),
        expect.objectContaining({ status: 'completed' }),
      );

      // Instance paused on the timer reason, carrying the __wait metadata.
      expect(mockInstanceUpdate).toHaveBeenCalledWith(
        'inst-1',
        expect.objectContaining({
          status: 'paused',
          pauseReason: 'waiting_for_timer',
          variables: expect.objectContaining({ __wait: waitSentinel.__wait }),
        }),
      );

      // Paused, not advanced — the wait step stays current until resume.
      expect(mockAdvanceStep).not.toHaveBeenCalled();
    });
  });

  describe('human pre-assignment (assignedTo)', () => {
    const assignedHumanWorkflow = {
      ...workflowDefinition,
      steps: [
        { id: 'fill-form', name: 'Fill Form', type: 'creation', executor: 'human', allowedRoles: ['member'], assignedTo: '${triggerPayload.userId}' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'fill-form', to: 'done' }],
    };

    it('[DATA] pre-assigns the task to the interpolated user (claimed + assignedUserId)', async () => {
      mockInstanceGetById.mockImplementation(() =>
        Promise.resolve({
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
          status: 'running', currentStepId: 'fill-form', configName: undefined,
          variables: {}, triggerPayload: { userId: 'filip' },
        }),
      );
      mockGetWorkflowDefinition.mockResolvedValue(assignedHumanWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockHumanTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        stepId: 'fill-form',
        assignedRole: 'member',
        assignedUserId: 'filip',
        status: 'claimed',
        creationReason: 'human_executor',
      }));
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'paused',
        pauseReason: 'waiting_for_human',
      }));
      // A plain uid is a uid already — no directory round-trip.
      expect(mockResolveUser).not.toHaveBeenCalled();
    });

    const emailAssignedWorkflow = {
      ...workflowDefinition,
      steps: [
        { id: 'fill-form', name: 'Fill Form', type: 'creation', executor: 'human', allowedRoles: ['member'], assignedTo: '${triggerPayload.reviewer}' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'fill-form', to: 'done' }],
    };

    it('[DATA] resolves an email assignedTo to the user uid before persisting', async () => {
      mockResolveUser.mockResolvedValue({ uid: 'uid-filip', email: 'filip@appsilon.com' });
      mockInstanceGetById.mockImplementation(() =>
        Promise.resolve({
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
          status: 'running', currentStepId: 'fill-form', configName: undefined,
          variables: {}, triggerPayload: { reviewer: 'filip@appsilon.com' },
        }),
      );
      mockGetWorkflowDefinition.mockResolvedValue(emailAssignedWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockResolveUser).toHaveBeenCalledWith('filip@appsilon.com');
      expect(mockHumanTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        stepId: 'fill-form',
        assignedUserId: 'uid-filip',
        status: 'claimed',
      }));
    });

    it('[ERROR] fails the instance when an email assignedTo matches no user', async () => {
      mockResolveUser.mockResolvedValue(null);
      mockInstanceGetById.mockImplementation(() =>
        Promise.resolve({
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
          status: 'running', currentStepId: 'fill-form', configName: undefined,
          variables: {}, triggerPayload: { reviewer: 'ghost@appsilon.com' },
        }),
      );
      mockGetWorkflowDefinition.mockResolvedValue(emailAssignedWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockHumanTaskCreate).not.toHaveBeenCalled();
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('matches no Mediforce user'),
      }));
    });

    it('[ERROR] fails the instance when assignedTo resolves to nothing', async () => {
      mockInstanceGetById.mockImplementation(() =>
        Promise.resolve({
          id: 'inst-1', namespace: 'test-ns', definitionName: 'community-digest', definitionVersion: '1',
          status: 'running', currentStepId: 'fill-form', configName: undefined,
          variables: {}, triggerPayload: {},
        }),
      );
      mockGetWorkflowDefinition.mockResolvedValue(assignedHumanWorkflow);

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });
      expect(res.status).toBe(202);
      expect(afterCallback).not.toBeNull();
      await afterCallback!();

      expect(mockHumanTaskCreate).not.toHaveBeenCalled();
      expect(mockInstanceUpdate).toHaveBeenCalledWith('inst-1', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('assignedTo'),
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
        id: 'inst-1', namespace: 'test-ns', status: 'completed', configName: 'default',
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });

      expect(res.status).toBe(409);
    });

    it('[AUTH] returns 403 when user is not a member of the instance namespace', async () => {
      mockResolveCallerIdentity.mockReturnValue({
        kind: 'user',
        uid: 'outsider',
        namespaces: new Set(['other-ns']),
        namespaceRoles: new Map([['other-ns', 'member']]),
        isSystemActor: false,
      });
      mockInstanceGetById.mockResolvedValue({
        id: 'inst-1',
        namespace: 'test-ns',
        definitionName: 'community-digest',
        definitionVersion: '1',
        status: 'running',
        currentStepId: 'gather-data',
        variables: {},
        triggerPayload: {},
      });

      const res = await POST(makeRequest(), { params: makeParams('inst-1') });

      expect(res.status).toBe(403);
    });
  });
});
