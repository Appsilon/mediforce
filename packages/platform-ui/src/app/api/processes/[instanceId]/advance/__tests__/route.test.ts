// packages/platform-ui/src/app/api/processes/[instanceId]/advance/__tests__/route.test.ts
// Tests that AdvanceStepBody no longer accepts autonomyLevel

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWorkflowStep = { id: 'compliance-check', name: 'Compliance Check', type: 'creation', executor: 'agent', autonomyLevel: 'L2' };

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: {
      getById: vi.fn().mockResolvedValue({
        id: 'inst-001',
        namespace: 'test-ns',
        definitionName: 'test-workflow',
        definitionVersion: '1',
        status: 'running',
        currentStepId: 'compliance-check',
      }),
    },
    processRepo: {
      getWorkflowDefinition: vi.fn().mockResolvedValue({
        name: 'test-workflow',
        version: 1,
        steps: [mockWorkflowStep],
        transitions: [],
      }),
      getLatestWorkflowVersion: vi.fn().mockResolvedValue(1),
    },
    namespaceRepo: {},
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

vi.mock('@/lib/execute-agent-step', () => ({
  executeAgentStep: vi.fn().mockResolvedValue({
    instanceId: 'inst-001',
    status: 'running',
    currentStepId: 'step-2',
    agentRunStatus: 'completed',
  }),
}));

import { POST } from '../route';
import { executeAgentStep } from '@/lib/execute-agent-step';

const mockExecuteAgentStep = vi.mocked(executeAgentStep);

describe('advance route', () => {
  beforeEach(() => {
    mockExecuteAgentStep.mockClear();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
  });

  it('[AUTH] POST calls executeAgentStep without autonomyLevel, and no budget user for an API key', async () => {
    const body = {
      stepId: 'compliance-check',
      appContext: { studyId: 'S1' },
      triggeredBy: 'user-1',
    };

    const req = new Request('http://localhost/api/processes/inst-001/advance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-key',
      },
      body: JSON.stringify(body),
    });

    await POST(req, { params: Promise.resolve({ instanceId: 'inst-001' }) });

    expect(mockExecuteAgentStep).toHaveBeenCalledWith(
      'inst-001',
      'compliance-check',
      mockWorkflowStep,
      { studyId: 'S1' },
      'user-1',
      undefined,
      { budgetUserId: null },
    );
  });

  it('[AUTH] takes the budget user from the signed-in caller, never from triggeredBy', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'member-1',
      namespaces: new Set(['test-ns']),
      namespaceRoles: new Map([['test-ns', 'member']]),
      isSystemActor: false,
    });
    const req = new Request('http://localhost/api/processes/inst-001/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: 'compliance-check', appContext: {}, triggeredBy: 'someone-else' }),
    });

    await POST(req, { params: Promise.resolve({ instanceId: 'inst-001' }) });

    const options = mockExecuteAgentStep.mock.calls[0][6];
    expect(options).toEqual({ budgetUserId: 'member-1' });
  });

  it('[DATA] POST with autonomyLevel in body ignores it (not passed to executeAgentStep)', async () => {
    const body = {
      stepId: 'compliance-check',
      appContext: { studyId: 'S1' },
      triggeredBy: 'user-1',
      autonomyLevel: 'L4', // Should be ignored
    };

    const req = new Request('http://localhost/api/processes/inst-001/advance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-key',
      },
      body: JSON.stringify(body),
    });

    await POST(req, { params: Promise.resolve({ instanceId: 'inst-001' }) });

    // None of the args should be 'L4' or any autonomy level
    const args = mockExecuteAgentStep.mock.calls[0];
    expect(args).not.toContain('L4');
  });

  it('[AUTH] returns 403 when user is not a member of the instance namespace', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['other-ns']),
      namespaceRoles: new Map([['other-ns', 'member']]),
      isSystemActor: false,
    });

    const req = new Request('http://localhost/api/processes/inst-001/advance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-key',
      },
      body: JSON.stringify({
        stepId: 'compliance-check',
        appContext: { studyId: 'S1' },
        triggeredBy: 'user-1',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ instanceId: 'inst-001' }) });

    expect(res.status).toBe(403);
  });
});
