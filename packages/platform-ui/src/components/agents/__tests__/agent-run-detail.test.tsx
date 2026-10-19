import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { buildAgentRun } from '@mediforce/platform-core/testing';

const mockRunOutputFiles = vi.fn();
vi.mock('@/hooks/use-run-output-files', () => ({
  useRunOutputFiles: (...args: unknown[]) => mockRunOutputFiles(...args),
}));

vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test',
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import { AgentRunDetail } from '../agent-run-detail';

const LISTING = { stepId: 'grade', name: 'listing.csv', path: '.mediforce/output/grade/listing.csv', size: 64 };

describe('AgentRunDetail output', () => {
  beforeEach(() => {
    mockRunOutputFiles.mockReset();
    mockRunOutputFiles.mockReturnValue({ data: [LISTING], loading: false, error: null });
  });

  it('keeps the committed Output Files of a failed run that wrote no result.json', () => {
    render(<AgentRunDetail run={buildAgentRun({ stepId: 'grade', status: 'error', envelope: null })} />);

    const options = within(screen.getByRole('combobox', { name: 'Step output file' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['result.json', 'listing.csv (64 B)']);
    expect(screen.getByTestId('step-result-json')).toHaveTextContent('No result.json produced');
  });

  it('waits for a running run instead of claiming it produced nothing', () => {
    render(<AgentRunDetail run={buildAgentRun({ stepId: 'grade', status: 'running', envelope: null })} />);

    expect(screen.getByText('Output not produced yet')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Step output file' })).not.toBeInTheDocument();
  });
});
