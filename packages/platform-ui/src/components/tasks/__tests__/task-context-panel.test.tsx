import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { StepExecution } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';

const mockStepExecutions = vi.fn();
vi.mock('@/hooks/use-step-executions', () => ({
  useStepExecutions: (...args: unknown[]) => mockStepExecutions(...args),
}));

const mockProcessInstance = vi.fn(() => ({ data: { status: 'running' }, loading: false }));
vi.mock('@/hooks/use-process-instances', () => ({
  useProcessInstance: (...args: unknown[]) => mockProcessInstance(...args),
}));

const mockRunOutputFiles = vi.fn();
vi.mock('@/hooks/use-run-output-files', () => ({
  useRunOutputFiles: (...args: unknown[]) => mockRunOutputFiles(...args),
}));

import { TaskContextPanel } from '../task-context-panel';

type StepExecutionRecord = StepExecution & { id: string };

function buildExecution(overrides: Partial<StepExecutionRecord> = {}): StepExecutionRecord {
  return {
    id: 'exec-1',
    instanceId: 'inst-1',
    stepId: 'interpret-validation',
    status: 'completed',
    input: {},
    output: { foo: 'bar' },
    verdict: null,
    executedBy: 'agent:claude-code',
    startedAt: '2026-04-29T10:00:00.000Z',
    completedAt: '2026-04-29T10:01:00.000Z',
    iterationNumber: 0,
    gateResult: null,
    error: null,
    ...overrides,
  };
}

function setStepExecutions(executions: StepExecutionRecord[], loading = false): void {
  mockStepExecutions.mockReturnValue({ data: executions, loading, error: null });
}

const reportFile: RunOutputFileEntry = {
  stepId: 'interpret-validation',
  name: 'presentation.html',
  path: '.mediforce/output/interpret-validation/presentation.html',
  size: 2048,
};

describe('TaskContextPanel', () => {
  beforeEach(() => {
    mockRunOutputFiles.mockReset();
    mockRunOutputFiles.mockReturnValue({ data: [reportFile], loading: false, error: null });
  });

  it('shows the previous step\'s result.json, with its Output Files in the dropdown', () => {
    setStepExecutions([buildExecution({ output: { findings: 2 } })]);

    render(<TaskContextPanel processInstanceId="inst-1" stepId="human-review" />);

    expect(screen.getByText('(interpret-validation)')).toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Step output file' });
    expect(picker).toHaveValue('result.json');
    expect(within(picker).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['result.json', 'presentation.html (2.0 KB)']);
    expect(screen.getByTestId('step-result-json').textContent).toBe(JSON.stringify({ findings: 2 }, null, 2));
    expect(mockRunOutputFiles).toHaveBeenCalledWith('inst-1', 'running');
  });

  it('shows the latest completed step that ran before this one', () => {
    setStepExecutions([
      buildExecution({ id: 'exec-1', stepId: 'extract', output: { first: true }, startedAt: '2026-04-29T09:00:00.000Z' }),
      buildExecution({ id: 'exec-2', stepId: 'interpret-validation', output: { second: true }, startedAt: '2026-04-29T10:00:00.000Z' }),
      buildExecution({ id: 'exec-3', stepId: 'human-review', status: 'pending', output: null, startedAt: '2026-04-29T11:00:00.000Z' }),
    ]);

    render(<TaskContextPanel processInstanceId="inst-1" stepId="human-review" />);

    expect(screen.getByText('(interpret-validation)')).toBeInTheDocument();
    expect(screen.getByTestId('step-result-json').textContent).toContain('"second": true');
  });

  it('renders nothing when there is no previous step output to show', () => {
    setStepExecutions([buildExecution({ output: null })]);

    const { container } = render(<TaskContextPanel processInstanceId="inst-1" stepId="human-review" />);

    expect(container).toBeEmptyDOMElement();
  });
});
