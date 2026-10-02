import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { JudgeVerdict } from '@mediforce/platform-core';
import { JudgeVerdicts } from '../judge-verdicts';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useEvalRunMutation: (_step: unknown, _evalRunId: string, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown, options?: { onSuccess?: () => void }) => { void mutationFn(value); options?.onSuccess?.(); },
    isPending: false,
    error: null,
  }),
}));

const evaluation = vi.hoisted(() => ({ reviewJudgeVerdict: vi.fn() }));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));

const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
const EVAL_RUN = '7e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

function verdictOf(overrides: Partial<JudgeVerdict>): JudgeVerdict {
  return {
    trialId: '1e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', trialIndex: 0, variantId: 'champion',
    caseId: '2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', caseName: 'Sepsis, fatal', agentRunId: 'agent-run-1',
    evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'grades-justified', severity: 'critical',
    scoreId: '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', passed: false, confidence: 0.6, minConfidence: 0.8,
    rationale: 'Log entry [4] reads the fatal outcome, yet the output grades sepsis 3.',
    review: null, counts: false,
    ...overrides,
  };
}

describe('JudgeVerdicts', () => {
  beforeEach(() => evaluation.reviewJudgeVerdict.mockClear());

  it('shows each verdict with its confidence, whether it counts, and the judge\'s rationale', () => {
    render(<JudgeVerdicts step={step} evalRunId={EVAL_RUN} verdicts={[
      verdictOf({}),
      verdictOf({ trialId: '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', trialIndex: 1, passed: true, confidence: 0.92, counts: true, rationale: 'Sepsis graded 5.' }),
    ]} mayEdit={true} editReason={undefined} />);

    const [unsure, confident] = screen.getAllByTestId('judge-verdict');
    expect(unsure!.textContent).toContain('Sepsis, fatal · trial 1');
    expect(unsure!.textContent).toContain('fail');
    expect(unsure!.textContent).toContain('confidence 0.6 (below 0.8)');
    expect(unsure!.textContent).toContain('left out — below its minimum confidence');
    expect(unsure!.textContent).toContain('Log entry [4] reads the fatal outcome, yet the output grades sepsis 3.');
    expect(confident!.textContent).toContain('counts');
    expect(screen.getByTestId('judge-verdicts-summary').textContent).toBe('Judge verdicts — 2, 1 left out of the criteria');
  });

  it('accepts a verdict, so it counts', () => {
    render(<JudgeVerdicts step={step} evalRunId={EVAL_RUN} verdicts={[verdictOf({})]} mayEdit={true} editReason={undefined} />);
    const row = screen.getByTestId('judge-verdict');

    fireEvent.click(within(row).getByRole('button', { name: 'Accept' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm accept' }));

    expect(evaluation.reviewJudgeVerdict).toHaveBeenCalledWith({
      evalRunId: EVAL_RUN, trialId: verdictOf({}).trialId, evaluatorId: verdictOf({}).evaluatorId, decision: 'accepted',
    });
  });

  it('denies a verdict with why, leaving it out', () => {
    render(<JudgeVerdicts step={step} evalRunId={EVAL_RUN} verdicts={[verdictOf({ confidence: 0.95, counts: true })]} mayEdit={true} editReason={undefined} />);
    const row = screen.getByTestId('judge-verdict');

    fireEvent.click(within(row).getByRole('button', { name: 'Deny' }));
    fireEvent.change(within(row).getByLabelText('Why (optional)'), { target: { value: 'The source says the outcome was not fatal.' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm deny' }));

    expect(evaluation.reviewJudgeVerdict).toHaveBeenCalledWith({
      evalRunId: EVAL_RUN, trialId: verdictOf({}).trialId, evaluatorId: verdictOf({}).evaluatorId, decision: 'denied',
      comment: 'The source says the outcome was not fatal.',
    });
  });

  it('shows who reviewed a verdict, and lets only an editor review', () => {
    render(<JudgeVerdicts step={step} evalRunId={EVAL_RUN} verdicts={[verdictOf({
      counts: false,
      review: { decision: 'denied', reviewedBy: 'reviewer-1', reviewedAt: '2026-10-01T10:00:00.000Z', comment: 'Misread the source.' },
    })]} mayEdit={false} editReason="You may not edit this workflow" />);
    const row = screen.getByTestId('judge-verdict');

    expect(row.textContent).toContain('left out — denied by reviewer-1');
    expect(row.textContent).toContain('Misread the source.');
    expect((within(row).getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
