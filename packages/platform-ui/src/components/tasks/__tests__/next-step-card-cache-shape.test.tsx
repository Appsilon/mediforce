import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

// NextStepCard (step page) and the workflow page header read the *same*
// react-query key, `queryKeys.workflow`. This test walks that cache the way a
// user does — open a step page, then the workflow page — and asserts the second
// reader finds a WorkflowDefinition, not whatever envelope the first stored.

const mockStepExecutions = vi.fn();
vi.mock('@/hooks/use-step-executions', () => ({
  useStepExecutions: (...args: unknown[]) => mockStepExecutions(...args),
}));

const mockProcessInstance = vi.fn();
vi.mock('@/hooks/use-process-instances', () => ({
  useProcessInstance: (...args: unknown[]) => mockProcessInstance(...args),
}));

const mockWorkflowsGet = vi.fn();
const mockTasksList = vi.fn();
vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    workflows: { get: (...args: unknown[]) => mockWorkflowsGet(...args) },
    tasks: { list: (...args: unknown[]) => mockTasksList(...args) },
  },
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

import { NextStepCard } from '../next-step-card';
import { useWorkflowVersion } from '@/hooks/use-workflow-versions';
import { queryKeys } from '@/lib/query-keys';
import { createQueryWrapper } from '@/test/react-query';

// `useHandleFromPath` is mocked globally in src/test/setup.ts.
const HANDLE = 'test-org';
const WORKFLOW_NAME = 'tutorial-trigger-input';

const DEFINITION = {
  name: WORKFLOW_NAME,
  version: 3,
  namespace: HANDLE,
  steps: [
    { id: 'review', type: 'task', executor: 'human' },
    { id: 'publish', type: 'terminal' },
  ],
};

/** Stand-in for the workflow page header, which renders `steps.length`. */
function WorkflowHeader(): React.ReactElement {
  const { definition } = useWorkflowVersion(WORKFLOW_NAME, HANDLE, 3);
  if (definition === null) return <span data-testid="step-count">loading</span>;
  return <span data-testid="step-count">{definition.steps.length} steps</span>;
}

describe('workflow definition cache shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessInstance.mockReturnValue({
      data: {
        id: 'run-1',
        status: 'running',
        definitionName: WORKFLOW_NAME,
        definitionVersion: '3',
      },
      loading: false,
    });
    mockStepExecutions.mockReturnValue({
      data: [
        {
          id: 'exec-1',
          stepId: 'review',
          status: 'completed',
          startedAt: '2026-08-01T10:00:00.000Z',
          gateResult: { next: 'publish' },
        },
      ],
      loading: false,
    });
    mockWorkflowsGet.mockResolvedValue({ definition: DEFINITION });
    mockTasksList.mockResolvedValue({ tasks: [] });
  });

  it('leaves a definition the workflow header can read after a step page primed it', async () => {
    const { queryClient } = createQueryWrapper();
    const cacheKey = queryKeys.workflow(HANDLE, WORKFLOW_NAME, 3);

    const stepPage = render(
      <QueryClientProvider client={queryClient}>
        <NextStepCard processInstanceId="run-1" stepId="review" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryClient.getQueryData(cacheKey)).not.toBeUndefined());
    stepPage.unmount();

    expect(queryClient.getQueryData(cacheKey)).toMatchObject({ steps: DEFINITION.steps });

    // The header assertion is synchronous on purpose: it renders from the
    // cached entry *before* its own refetch resolves, and that first paint is
    // where a mismatched shape crashes.
    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowHeader />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('step-count').textContent).toBe('2 steps');
  });
});
