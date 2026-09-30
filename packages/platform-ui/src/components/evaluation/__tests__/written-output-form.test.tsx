import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WriteOutputForm, describeChanges, emptyOutput, outputFields } from '../written-output-form';

const evaluation = vi.hoisted(() => ({ createWrittenOutput: vi.fn() }));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));

vi.mock('@/hooks/use-step-evaluation', () => ({
  useAgentRunIo: (agentRunId: string | null) => ({
    isError: false,
    error: null,
    data: agentRunId === null ? undefined : {
      agentRunId, status: 'completed', reasoningSummary: null, confidence: null,
      stepInput: { narrative: 'ANC 0.4 on day 8.' },
      result: { grade: 4, term: 'Neutropenia', rationale: 'ANC below 0.5.', flags: ['lab'] },
    },
  }),
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
  }),
}));

const schema = {
  type: 'object' as const,
  required: ['grade', 'rationale'],
  properties: { grade: { type: 'integer' as const }, term: { type: 'string' as const, enum: ['Neutropenia', 'Anaemia'] }, rationale: { type: 'string' as const }, flags: { type: 'array' as const } },
};

describe('the output as a form', () => {
  it('takes its fields and their kinds from the step\'s output schema, then any other key the output has', () => {
    expect(outputFields(schema, { grade: 4, extra: true }).map((field) => [field.key, field.type, field.required, field.options])).toEqual([
      ['grade', 'integer', true, null],
      ['term', 'string', false, ['Neutropenia', 'Anaemia']],
      ['rationale', 'string', true, null],
      ['flags', 'json', false, null],
      ['extra', 'boolean', false, null],
    ]);
    expect(emptyOutput(schema)).toEqual({ grade: 0, term: '', rationale: '', flags: null });
  });

  it('says what changed, value by value', () => {
    expect(describeChanges({ grade: 4, flags: ['lab'], rationale: 'x' }, { grade: 2, flags: ['lab', 'fatal'], rationale: 'x' }))
      .toEqual(['grade: 4 → 2', 'flags: ["lab"] → ["lab","fatal"]']);
    expect(describeChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('WriteOutputForm', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const evaluator = { id: 'judge-1' } as never;
  const run = { id: 'run-00000001', startedAt: '2026-09-24T08:00:00.000Z' } as never;

  it('starts from a run\'s output, marks what the person changed, and saves it labelled for the judge', () => {
    const onClose = vi.fn();
    render(<WriteOutputForm step={step} evaluator={evaluator} runs={[run]} stepOutputSchema={schema} onClose={onClose} />);

    expect(screen.getByTestId('write-output-changes').textContent).toContain('Nothing changed yet');
    fireEvent.change(screen.getByLabelText('Output field grade'), { target: { value: '2' } });
    expect(screen.getByTestId('write-output-changes').textContent).toBe('Changed: grade: 4 → 2');
    expect(screen.getAllByText('changed')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Grade 4 neutropenia written as 2.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as fail' }));

    expect(evaluation.createWrittenOutput).toHaveBeenCalledWith({
      ...step,
      basedOnAgentRunId: 'run-00000001',
      result: { grade: 2, term: 'Neutropenia', rationale: 'ANC below 0.5.', flags: ['lab'] },
      note: 'Grade 4 neutropenia written as 2.',
      label: { evaluatorId: 'judge-1', passed: false },
    });
  });

  it('offers the schema\'s choices for an enumerated field', () => {
    render(<WriteOutputForm step={step} evaluator={evaluator} runs={[run]} stepOutputSchema={schema} onClose={() => undefined} />);
    const term = screen.getByLabelText('Output field term') as HTMLSelectElement;
    expect([...term.options].map((option) => option.value)).toEqual(['Neutropenia', 'Anaemia']);
  });
});
