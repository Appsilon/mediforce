import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvaluationBriefField, EvaluationBriefToggle } from '../evaluation-brief-field';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
  }),
}));

const evaluation = vi.hoisted(() => ({ setBrief: vi.fn() }));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));

const STEP = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
const written = {
  isLoading: false,
  isError: false,
  data: {
    brief: {
      ...STEP,
      version: 1,
      text: 'A **critical** check.',
      origin: 'user',
      createdBy: 'author-1',
      createdAt: '2026-09-24T08:00:00.000Z',
    },
  },
} as never;
const unwritten = { isLoading: false, isError: false, data: { brief: null } } as never;

describe('EvaluationBriefField', () => {
  it('renders the Evaluation Brief as Markdown with its version', () => {
    render(<EvaluationBriefField step={STEP} brief={written} mayEdit={false} />);

    expect(screen.getByText('critical').tagName).toBe('STRONG');
    expect(screen.queryByText('A **critical** check.')).toBeNull();
    expect(screen.getByText(/v1 · written by author-1/)).toBeTruthy();
  });

  it('says the Brief is the assistant\'s context shared by the Step, not tied to a Step Qualification', () => {
    render(<EvaluationBriefField step={STEP} brief={unwritten} mayEdit={false} />);

    const purpose = screen.getByTestId('brief-purpose').textContent;
    expect(purpose).toContain('The assistant reads it on every turn');
    expect(purpose).toContain('shared with everyone evaluating this step');
    expect(purpose).not.toContain('Qualification');
    expect(screen.queryByRole('button', { name: 'Write' })).toBeNull();
  });

  it('says a Brief failed to load instead of offering to write a first one', () => {
    const refetch = vi.fn();
    render(<EvaluationBriefField step={STEP} brief={{ isLoading: false, isError: true, data: undefined, refetch } as never} mayEdit />);

    expect(screen.getByRole('alert').textContent).toContain('Could not load the step brief.');
    expect(screen.queryByText(/No Brief yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('saves an edit as the next version', () => {
    render(<EvaluationBriefField step={STEP} brief={written} mayEdit />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Step brief'), { target: { value: 'Grades AEs for the DSMB.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as v2' }));

    expect(evaluation.setBrief).toHaveBeenCalledWith({ ...STEP, text: 'Grades AEs for the DSMB.' });
  });
});

describe('EvaluationBriefToggle', () => {
  it('marks a written Brief and leaves an unwritten one unmarked', () => {
    const { rerender } = render(<EvaluationBriefToggle brief={written} open={false} onToggle={() => undefined} />);
    expect(screen.getByTestId('brief-indicator')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the step brief' }).getAttribute('aria-expanded')).toBe('false');

    rerender(<EvaluationBriefToggle brief={unwritten} open onToggle={() => undefined} />);
    expect(screen.queryByTestId('brief-indicator')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide the step brief' }).getAttribute('aria-expanded')).toBe('true');
  });
});
