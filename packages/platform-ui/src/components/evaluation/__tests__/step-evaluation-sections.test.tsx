import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefSection, DriftAlert, McpPolicySection } from '../step-evaluation-sections';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: () => ({ mutate: vi.fn(), isPending: false }),
}),);

vi.mock('@/lib/mediforce', () => ({
  mediforce: { evaluation: { setBrief: vi.fn() } },
}));

describe('BriefSection', () => {
  it('renders the Evaluation Brief as Markdown', () => {
    render(
      <BriefSection
        step={{ namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' }}
        data={{
          isLoading: false,
          data: {
            brief: {
              namespace: 'acme',
              workflowName: 'safety',
              stepId: 'grade-aes',
              version: 1,
              text: 'A **critical** check.',
              origin: 'user',
              createdBy: 'author-1',
              createdAt: '2026-09-24T08:00:00.000Z',
            },
          },
        } as never}
        mayEdit={false}
      />,
    );

    expect(screen.getByText('critical').tagName).toBe('STRONG');
    expect(screen.queryByText('A **critical** check.')).toBeNull();
  });

  it('says a Step Qualification cites the Brief version', () => {
    render(<BriefSection step={{ namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' }} data={{ isLoading: false, data: { brief: null } } as never} mayEdit={false} />);

    expect(screen.getByTestId('brief-purpose').textContent).toContain('a Step Qualification cites the Brief version');
  });
});

describe('DriftAlert', () => {
  const evaluator = {
    evaluatorId: 'e-1', name: 'grade-5-is-fatal', severity: 'critical', evaluatorVersion: 2,
    recentMean: 0.6, baselineMean: 0.9, recentCount: 20, baselineCount: 20, drifting: true,
  };

  it('names each drifting production Evaluator with its drop', () => {
    render(<DriftAlert data={{ data: { window: 20, threshold: 0.15, evaluators: [evaluator, { ...evaluator, evaluatorId: 'e-2', name: 'no-phi', drifting: false }] } } as never} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('grade-5-is-fatal v2 (critical): mean 0.60 over the last 20 production Scores, down from 0.90');
    expect(alert.textContent).not.toContain('no-phi');
  });

  it('shows nothing while no Evaluator drifts', () => {
    render(<DriftAlert data={{ data: { window: 20, threshold: 0.15, evaluators: [{ ...evaluator, drifting: false }] } } as never} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('McpPolicySection', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const server = { name: 'meddra', mode: 'deny', defaulted: true, recordedCaseIds: [] };

  it('says what the mode each server is in does in a trial', () => {
    render(<McpPolicySection step={step} data={{ isLoading: false, data: { servers: [server, { ...server, name: 'ctcae', mode: 'replay', defaulted: false }] } } as never} mayEdit={true} />);

    const [meddra, ctcae] = screen.getAllByTestId('mcp-policy-server');
    expect(meddra!.textContent).toContain('cannot use this server during a trial');
    expect(ctcae!.textContent).toContain('answered from what a live trial of the same case recorded');
  });
});
