import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';

const mockRunOutputFiles = vi.fn();
vi.mock('@/hooks/use-run-output-files', () => ({
  useRunOutputFiles: (...args: unknown[]) => mockRunOutputFiles(...args),
}));

import { AgentOutputReviewPanel } from '../agent-output-review-panel';
import type { AgentOutputData } from '../task-utils';

function buildAgentOutput(overrides: Partial<AgentOutputData> = {}): AgentOutputData {
  return {
    confidence: null,
    confidence_rationale: null,
    reasoning: null,
    result: null,
    model: null,
    duration_ms: null,
    estimatedCostUsd: null,
    tokenUsage: null,
    gitMetadata: null,
    escalationReason: null,
    ...overrides,
  };
}

function renderPanel(agentOutput: AgentOutputData) {
  return render(
    <AgentOutputReviewPanel agentOutput={agentOutput} stepId="draft-report" runId="run-1" runStatus="paused" />,
  );
}

const reportFile: RunOutputFileEntry = {
  stepId: 'draft-report',
  name: 'presentation.md',
  path: '.mediforce/output/draft-report/presentation.md',
  size: 120,
};

describe('AgentOutputReviewPanel', () => {
  beforeEach(() => {
    mockRunOutputFiles.mockReset();
    mockRunOutputFiles.mockReturnValue({ data: [reportFile], loading: false, error: null });
  });

  it('opens the step output on result.json, with the step\'s files in the dropdown', () => {
    const result = { drug: 'Keytruda', grade: 3 };
    renderPanel(buildAgentOutput({ result }));

    const picker = screen.getByRole('combobox', { name: 'Step output file' });
    expect(picker).toHaveValue('result.json');
    expect(within(picker).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['result.json', 'presentation.md (120 B)']);
    expect(within(screen.getByTestId('step-result-json')).getByText('Keytruda')).toBeInTheDocument();
    expect(mockRunOutputFiles).toHaveBeenCalledWith('run-1', 'paused');
  });

  it('renders escalation badge when escalationReason is set', () => {
    renderPanel(buildAgentOutput({
      result: { verdict: 'approve' },
      confidence: 0.72,
      escalationReason: 'low_confidence',
    }));

    expect(screen.getByText(/escalated: low confidence/i)).toBeInTheDocument();
  });

  it('omits escalation badge when escalationReason is null', () => {
    renderPanel(buildAgentOutput({ result: { verdict: 'approve' }, confidence: 0.9 }));

    expect(screen.queryByText(/escalated/i)).not.toBeInTheDocument();
  });

  it('renders iterations_limit escalation badge', () => {
    renderPanel(buildAgentOutput({ result: { verdict: 'revise' }, escalationReason: 'iterations_limit' }));

    expect(screen.getByText(/escalated: iterations limit reached/i)).toBeInTheDocument();
  });

  it('lists the step commit\'s changed files without a compare link', () => {
    renderPanel(buildAgentOutput({
      result: { verdict: 'approve' },
      gitMetadata: {
        commitSha: 'abcdef1234567890',
        branch: 'agent/run-42',
        changedFiles: ['file.ts'],
        repoUrl: 'https://github.com/example/repo',
      },
    }));

    expect(screen.getByText('Generated Files')).toBeInTheDocument();
    expect(screen.getByText('file.ts')).toBeInTheDocument();
    for (const link of Array.from(document.querySelectorAll('a'))) {
      expect(link.getAttribute('href') ?? '').not.toContain('/compare/main...');
    }
  });

  it('renders cost and token usage when present (single metrics row)', () => {
    renderPanel(buildAgentOutput({
      result: { ok: true },
      confidence: 0.88,
      model: 'haiku',
      duration_ms: 78000,
      estimatedCostUsd: 0.0123,
      tokenUsage: { inputTokens: 59, outputTokens: 6297 },
    }));

    expect(screen.getByText(/\$0\.012/)).toBeInTheDocument();
    expect(screen.getByText(/6,297/)).toBeInTheDocument();
    // Confidence rendered exactly once now that the display owns the metrics row
    expect(screen.queryAllByText(/88%/).length).toBe(1);
  });
});
