import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BriefSection, DriftAlert, EvaluatorsSection, McpPolicySection, toEvaluatorName } from '../step-evaluation-sections';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
  }),
}),);

const evaluation = vi.hoisted(() => ({
  setBrief: vi.fn(),
  createEvaluator: vi.fn(),
  addEvaluatorVersion: vi.fn(),
}));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: async () => new Response(JSON.stringify({ models: [] })),
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

describe('toEvaluatorName', () => {
  it('turns what a person types into a valid Evaluator name', () => {
    expect(toEvaluatorName('Grades match CTCAE')).toBe('grades-match-ctcae');
    expect(toEvaluatorName(' No PHI_leak!')).toBe('no-phi-leak-');
    expect(toEvaluatorName('x'.repeat(80))).toHaveLength(63);
  });
});

describe('EvaluatorsSection', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };

  function openForm() {
    render(<EvaluatorsSection step={step} data={{ isLoading: false, data: { evaluators: [] } } as never} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Evaluator name'), { target: { value: 'grades valid' } });
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'Every grade is 1 to 5.' } });
  }

  it('builds a code check from a language and a source, with no kind to type', () => {
    openForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'code' } });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'javascript' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'process.exit(0)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      name: 'grades-valid',
      severity: 'major',
      check: { kind: 'code', runtime: 'javascript', source: 'process.exit(0)' },
    }));
  });

  it('builds a judge from a question and verdicts, defaulting the model', async () => {
    evaluation.createEvaluator.mockClear();
    openForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'llm_judge' } });
    await waitFor(() => expect((screen.getByLabelText('Judge model') as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Question for the judge'), { target: { value: 'Is every grade justified?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Good / acceptable / poor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      check: {
        kind: 'llm_judge',
        model: 'anthropic/claude-sonnet-4',
        rubric: 'Is every grade justified?',
        choices: [{ label: 'good', value: 1 }, { label: 'acceptable', value: 0.5 }, { label: 'poor', value: 0 }],
      },
    }));
  });

  it('offers the built-in checks by what they do', () => {
    evaluation.createEvaluator.mockClear();
    openForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'builtin' } });
    fireEvent.change(screen.getByLabelText('Check'), { target: { value: 'result_stable' } });
    fireEvent.change(screen.getByLabelText('Keys'), { target: { value: 'grades, summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      check: { kind: 'builtin', name: 'result_stable', keys: ['grades', 'summary'] },
    }));
  });

  it('says what is wrong with a schema that is not JSON instead of sending it', () => {
    evaluation.createEvaluator.mockClear();
    openForm();
    fireEvent.change(screen.getByLabelText('JSON Schema'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('The schema is not valid JSON.')).toBeTruthy();
    expect(evaluation.createEvaluator).not.toHaveBeenCalled();
  });
});
