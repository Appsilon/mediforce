// packages/platform-ui/src/app/api/processes/[instanceId]/advance/__tests__/route.test.ts
// Tests that AdvanceStepBody no longer accepts autonomyLevel

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWorkflowStep = { id: 'compliance-check', name: 'Compliance Check', type: 'creation', executor: 'agent', autonomyLevel: 'L2' };

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: {
      getById: vi.fn().mockResolvedValue({
        id: 'inst-001',
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
  }),
}));

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
  });

  it('[AUTH] POST calls executeAgentStep with 4 args (no autonomyLevel)', async () => {
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
    );
    // Verify exactly 5 arguments (instanceId, stepId, workflowStep, appContext, triggeredBy)
    expect(mockExecuteAgentStep.mock.calls[0]).toHaveLength(5);
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

    // Should still only be called with 5 args (no autonomyLevel as separate arg)
    expect(mockExecuteAgentStep.mock.calls[0]).toHaveLength(5);
    // None of the args should be 'L4' or any autonomy level
    const args = mockExecuteAgentStep.mock.calls[0];
    expect(args).not.toContain('L4');
  });
});
