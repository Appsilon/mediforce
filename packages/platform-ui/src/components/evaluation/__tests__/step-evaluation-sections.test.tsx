import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AcceptanceCriteriaSection, CasesSection, DriftAlert, EvaluatorsSection, caseFromFile, datasetDrift, toEvaluatorName, withPassRate } from '../step-evaluation-sections';

const verdicts = vi.hoisted((): Record<string, 'positive' | 'negative'> => ({}));

vi.mock('@/hooks/use-step-evaluation', () => ({
  useAgentRunIo: (agentRunId: string | null) => ({
    isError: false,
    error: null,
    data: agentRunId === null ? undefined : {
      agentRunId,
      status: 'completed',
      stepInput: { narrative: `input of ${agentRunId}` },
      caseInput: { triggerPayload: { narrative: `input of ${agentRunId}` }, previousStepOutputs: {} },
      result: { grade: `output of ${agentRunId}` },
      reasoningSummary: null,
      confidence: null,
      verdictExpectation: verdicts[agentRunId] ?? null,
    },
  }),
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
    reset: () => undefined,
  }),
}),);

const evaluation = vi.hoisted(() => ({
  createEvaluator: vi.fn(),
  addEvaluatorVersion: vi.fn(),
  createCaseFromAgentRun: vi.fn(),
  setAcceptanceCriteria: vi.fn(),
  updateCase: vi.fn(),
  createCase: vi.fn(),
  archiveCase: vi.fn(),
}));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/components/agents/agent-log-panel', () => ({
  AgentRunLog: ({ run }: { run: { id: string } }) => <div data-testid="agent-run-log">{run.id}</div>,
}));

vi.mock('@/hooks/use-agent-runs', () => ({
  useAgentRun: (runId: string | null) => ({ data: runId === null ? null : { id: runId }, loading: false }),
}));

const evalCaseOf = (overrides: Record<string, unknown>) => ({
  id: 'c-1',
  namespace: 'acme',
  workflowName: 'safety',
  stepId: 'grade-aes',
  name: 'Sepsis, fatal',
  input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Sepsis' }] } } },
  workspaceSeedCommit: null,
  expectedOutput: { grade: 5 },
  expectation: 'positive',
  comparison: 'exact',
  agreementInstructions: null,
  evaluatorIds: null,
  source: 'production',
  sourceAgentRunId: 'run-00000001',
  perturbation: null,
  origin: 'user',
  split: 'dev',
  containsProductionData: true,
  archived: false,
  createdBy: 'author-1',
  createdAt: '2026-09-24T08:00:00.000Z',
  ...overrides,
});

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: async () => new Response(JSON.stringify({ models: [] })),
}));

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

  it('builds an expected-output check from an agreement judge model, instructions and a minimum agreement', async () => {
    evaluation.createEvaluator.mockClear();
    openForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'expected_output' } });
    await waitFor(() => expect((screen.getByLabelText('Agreement judge model') as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Agreement instructions'), { target: { value: 'A changed grade means low agreement.' } });
    expect((screen.getByLabelText('Minimum agreement') as HTMLInputElement).value).toBe('0.8');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      check: { kind: 'expected_output', model: 'anthropic/claude-sonnet-4', instructions: 'A changed grade means low agreement.', minAgreement: 0.8 },
    }));
  });

  it('builds a judge from a question and a minimum confidence, defaulting the model', async () => {
    evaluation.createEvaluator.mockClear();
    openForm();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'llm_judge' } });
    await waitFor(() => expect((screen.getByLabelText('Judge model') as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Question for the judge'), { target: { value: 'Is every grade justified?' } });
    expect((screen.getByLabelText('Minimum confidence') as HTMLInputElement).value).toBe('0.8');
    fireEvent.change(screen.getByLabelText('Minimum confidence'), { target: { value: '0.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      check: {
        kind: 'llm_judge',
        model: 'anthropic/claude-sonnet-4',
        rubric: 'Is every grade justified?',
        minConfidence: 0.9,
      },
    }));
  });

  it('starts a schema check from the step\'s own output schema', () => {
    const stepOutputSchema = { type: 'object' as const, required: ['grades'], properties: { grades: { type: 'array' as const } } };
    render(<EvaluatorsSection step={step} data={{ isLoading: false, data: { evaluators: [] } } as never} mayEdit={true} stepOutputSchema={stepOutputSchema} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const schema = screen.getByLabelText('JSON Schema') as HTMLTextAreaElement;
    expect(JSON.parse(schema.value)).toEqual(stepOutputSchema);
    fireEvent.change(schema, { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: "Use the step's output schema" }));
    expect(JSON.parse(schema.value)).toEqual(stepOutputSchema);
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

describe('Evaluator view and edit', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const version = {
    evaluatorId: '5b0f2f3e-8f5c-4c55-9d0a-3f1f7c1b2a10', version: 1, rule: 'Every grade is justified.', severity: 'major',
    check: { kind: 'llm_judge', model: 'anthropic/claude-sonnet-4', rubric: 'Is every grade justified?', minConfidence: 0.75 },
    origin: 'user', sourceApproval: null, createdBy: 'author-1', createdAt: '2026-09-24T08:00:00.000Z',
  };
  const evaluator = {
    ...step, id: version.evaluatorId, name: 'grades-justified', archived: false, runInProduction: false,
    createdBy: 'author-1', createdAt: '2026-09-24T08:00:00.000Z',
    latest: version, versions: [version], trust: { trusted: true }, production: { active: false },
  };
  const renderRow = () => render(<EvaluatorsSection step={step} data={{ isLoading: false, data: { evaluators: [evaluator] } } as never} mayEdit={true} />);

  it('shows what the check does', () => {
    renderRow();

    const details = screen.getByTestId('evaluator-details');
    expect(details.textContent).toContain('Is every grade justified?');
    expect(details.textContent).toContain('anthropic/claude-sonnet-4');
    expect(details.textContent).toContain('Minimum confidence0.75');
    expect(screen.getByTestId('evaluator-row').textContent).toContain('min confidence 0.75');
    expect(screen.queryByRole('button', { name: 'Label outputs' })).toBeNull();
  });

  it('saves only what changed as a new version, keeping the name', async () => {
    evaluation.addEvaluatorVersion.mockClear();
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect((screen.getByLabelText('Judge model') as HTMLSelectElement).disabled).toBe(false));
    expect((screen.getByLabelText('Evaluator name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Type') as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save as v2' }));
    expect(screen.getByText('Nothing changed.')).toBeTruthy();
    expect(evaluation.addEvaluatorVersion).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as v2' }));
    expect(evaluation.addEvaluatorVersion).toHaveBeenCalledWith({ evaluatorId: evaluator.id, severity: 'critical' });
  });
});

describe('Adding an Eval Case from a production run', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const agentRun = (id: string, summary: string) => ({
    id, status: 'completed', fallbackReason: null, startedAt: '2026-09-24T08:00:00.000Z', envelope: { reasoning_summary: summary },
  });
  const withRuns = (pages: unknown[][], more: { hasNextPage: boolean; fetchNextPage?: () => void }) => ({
    cases: { isLoading: false, data: { cases: [] } },
    agentRuns: { data: { pages: pages.map((runs) => ({ runs })) }, isFetchingNextPage: false, fetchNextPage: () => undefined, ...more },
    datasets: { data: { datasets: [] } },
    evaluators: { data: { evaluators: [] } },
  }) as never;
  const openDialog = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));
    return within(screen.getByTestId('case-dialog'));
  };

  it('has one way to add a case, and offers every loaded run to start from, loading more on request', () => {
    const fetchNextPage = vi.fn();
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-a', 'Graded 3 events.')], [agentRun('run-b', 'No events found.')]], { hasNextPage: true, fetchNextPage })} mayEdit={true} />);
    expect(screen.queryByRole('button', { name: 'Write a case' })).toBeNull();
    const dialog = openDialog();

    const options = Array.from((dialog.getByLabelText('Start from') as HTMLSelectElement).options).map((option) => option.textContent);
    expect(options.filter((option) => option?.includes('run-a') === true || option?.includes('run-b') === true)).toHaveLength(2);
    expect(dialog.getByTestId('add-case').textContent).toContain('Graded 3 events.');
    fireEvent.click(dialog.getByRole('button', { name: 'Load more runs' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('fills the input and the expected output from the run, and marks each as the run had it until changed', () => {
    evaluation.createCaseFromAgentRun.mockClear();
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-a', 'Graded 3 events.')]], { hasNextPage: false })} mayEdit={true} />);
    const dialog = openDialog();

    expect(JSON.parse((dialog.getByLabelText('Case input') as HTMLTextAreaElement).value)).toEqual({ triggerPayload: { narrative: 'input of run-a' }, previousStepOutputs: {} });
    expect(JSON.parse((dialog.getByLabelText('Expected output') as HTMLTextAreaElement).value)).toEqual({ grade: 'output of run-a' });
    expect(dialog.getByTestId('case-output-mark').textContent).toBe('As the source run');
    expect(dialog.getByTestId('case-form').textContent).toContain('Nobody reviewed this run');

    fireEvent.change(dialog.getByLabelText('Expected output'), { target: { value: '{"grade": 4}' } });
    expect(dialog.getByTestId('case-output-mark').textContent).toBe('Edited');
    fireEvent.click(dialog.getByRole('button', { name: 'Use the source run\'s output' }));
    expect(dialog.getByTestId('case-output-mark').textContent).toBe('As the source run');

    const edited = { triggerPayload: { narrative: 'an edited narrative' }, previousStepOutputs: {} };
    fireEvent.change(dialog.getByLabelText('Case input'), { target: { value: JSON.stringify(edited) } });
    expect(dialog.getByTestId('case-input-mark').textContent).toBe('Edited');
    fireEvent.click(dialog.getByRole('button', { name: 'Add case' }));

    expect(evaluation.createCaseFromAgentRun).toHaveBeenCalledWith({
      agentRunId: 'run-a', step, name: 'From run run-a (2026-09-24)', split: 'dev', input: edited,
      expectedOutput: { grade: 'output of run-a' }, expectation: 'positive', comparison: 'exact', agreementInstructions: null, evaluatorIds: null,
    });
  });

  it('starts from the newest run that is not a case yet, so adding at once makes no duplicate', () => {
    const evaluationWithCase = {
      cases: { isLoading: false, data: { cases: [evalCaseOf({ sourceAgentRunId: 'run-a' })] } },
      agentRuns: { data: { pages: [{ runs: [agentRun('run-a', ''), agentRun('run-b', '')] }] }, hasNextPage: false },
      datasets: { data: { datasets: [] } },
      evaluators: { data: { evaluators: [] } },
    } as never;
    render(<CasesSection step={step} evaluation={evaluationWithCase} mayEdit={true} />);
    const dialog = openDialog();
    expect((dialog.getByLabelText('Start from') as HTMLSelectElement).value).toBe('run:run-b');
  });

  it('starts a rejected run\'s case as negative', () => {
    verdicts['run-rejected'] = 'negative';
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-rejected', '')]], { hasNextPage: false })} mayEdit={true} />);
    const dialog = openDialog();

    expect((dialog.getByLabelText('Negative — the output must not match') as HTMLInputElement).checked).toBe(true);
    expect(dialog.getByTestId('case-form').textContent).not.toContain('Nobody reviewed this run');
  });

  it('opens the run\'s log inside the dialog, fetched only when opened', () => {
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-a', 'Graded 3 events.')]], { hasNextPage: false })} mayEdit={true} />);
    const dialog = openDialog();
    expect(dialog.queryByTestId('agent-run-log')).toBeNull();

    const log = dialog.getByTestId('source-run-log') as HTMLDetailsElement;
    log.open = true;
    fireEvent(log, new Event('toggle'));
    expect(dialog.getByTestId('agent-run-log').textContent).toBe('run-a');
  });
});

const evaluatorOf = (id: string, name: string, kind: string) => ({ id, name, latest: { check: { kind }, severity: 'critical' } });
const EXPECTED_OUTPUT_CHECK = evaluatorOf('e-expected', 'matches-expected', 'expected_output');
const SCHEMA_CHECK = evaluatorOf('e-schema', 'findings-present', 'schema');

describe('Eval Case view and edit', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const withCase = (evalCase: unknown, evaluators: unknown[] = [EXPECTED_OUTPUT_CHECK, SCHEMA_CHECK]) => ({
    cases: { isLoading: false, data: { cases: [evalCase] } },
    agentRuns: { data: { pages: [] }, hasNextPage: false },
    datasets: { data: { datasets: [] } },
    evaluators: { data: { evaluators } },
  }) as never;

  it('shows only what a case gives the step and what it expects, with Edit beside its labels', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);

    const details = screen.getByTestId('eval-case-details');
    expect(screen.getByTestId('eval-case-expected-output').textContent).toContain('An output that matches this, by exact match');
    expect(screen.getByTestId('eval-case-expected-output').textContent).toContain('"grade": 5');
    expect(details.textContent).toContain('Graded by: all evaluators');
    expect(screen.getByTestId('eval-case-input').textContent).toContain('"studyId": "CDISCPILOT01"');
    expect(details.textContent).not.toContain('Source:');
    expect(details.textContent).not.toContain('The source run');
    expect(details.textContent).not.toContain('Added by');
    expect(within(details).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(screen.getByTestId('eval-case-row')).getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('marks a case made from a run edited once it no longer gives or expects what the run did', () => {
    const asRun = { input: { triggerPayload: { narrative: 'input of run-00000001' }, previousStepOutputs: {} }, expectedOutput: { grade: 'output of run-00000001' } };
    const marks = [
      evalCaseOf(asRun),
      evalCaseOf({ ...asRun, source: 'manual' }),
      evalCaseOf({ ...asRun, expectedOutput: { grade: 5 } }),
      evalCaseOf({ ...asRun, expectedOutput: null }),
      evalCaseOf({ ...asRun, source: 'manual', input: { triggerPayload: {}, previousStepOutputs: {} } }),
    ].map((evalCase) => {
      const { unmount } = render(<CasesSection step={step} evaluation={withCase(evalCase)} mayEdit={false} />);
      const text = screen.getByTestId('eval-case-run-mark').textContent;
      unmount();
      return text;
    });
    expect(marks).toEqual(['from run', 'from run', 'edited from run', 'edited from run', 'edited from run']);
  });

  it('opens the source run\'s log from the details, for a person who cannot edit too', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({ source: 'synthesized' }))} mayEdit={false} />);
    const log = screen.getByTestId('source-run-log') as HTMLDetailsElement;
    log.open = true;
    fireEvent(log, new Event('toggle'));
    expect(screen.getByTestId('agent-run-log').textContent).toBe('run-00000001');
  });

  it('does not mark a case written by hand', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({ source: 'manual', sourceAgentRunId: null }))} mayEdit={false} />);
    expect(screen.queryByTestId('eval-case-run-mark')).toBeNull();
  });

  it('saves only what changed: an agreement comparison with the case\'s own instructions', () => {
    evaluation.updateCase.mockClear();
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText('Notes')).toBeNull();
    fireEvent.change(screen.getByLabelText('Comparison'), { target: { value: 'agreement' } });
    fireEvent.change(screen.getByLabelText('Agreement instructions'), { target: { value: 'Narrative wording is trivial; a changed grade is not.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(evaluation.updateCase).toHaveBeenCalledWith({
      caseId: 'c-1', comparison: 'agreement', agreementInstructions: 'Narrative wording is trivial; a changed grade is not.',
    });
  });

  it('marks a case negative, and lets only the Evaluators ticked grade it', () => {
    evaluation.updateCase.mockClear();
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByLabelText('Negative — the output must not match'));
    fireEvent.click(screen.getByLabelText('Selected evaluators'));
    fireEvent.click(screen.getByLabelText('Graded by findings-present'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(evaluation.updateCase).toHaveBeenCalledWith({ caseId: 'c-1', expectation: 'negative', evaluatorIds: ['e-expected'] });
  });

  it('says when nothing would compare a case\'s expected output', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}), [SCHEMA_CHECK])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('case-comparison').textContent).toContain('The step has no Expected output check yet');
  });

  it('offers positive or negative and the comparison even with no expected output, and saves clearing it as none', () => {
    evaluation.updateCase.mockClear();
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Expected output'), { target: { value: '' } });
    expect(screen.getByTestId('case-comparison').textContent).toContain('only the Evaluators grade the case');
    expect(screen.getByLabelText('Comparison')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(evaluation.updateCase).toHaveBeenCalledWith({ caseId: 'c-1', expectedOutput: null });
  });

  it('sets which Evaluators grade every selected case', async () => {
    evaluation.updateCase.mockClear();
    const evaluationOf = {
      cases: { isLoading: false, data: { cases: [evalCaseOf({ id: 'c-1', name: 'One' }), evalCaseOf({ id: 'c-2', name: 'Two' }), evalCaseOf({ id: 'c-3', name: 'Three' })] } },
      agentRuns: { data: { pages: [] }, hasNextPage: false },
      datasets: { data: { datasets: [] } },
      evaluators: { data: { evaluators: [EXPECTED_OUTPUT_CHECK, SCHEMA_CHECK] } },
    } as never;
    render(<CasesSection step={step} evaluation={evaluationOf} mayEdit={true} />);
    fireEvent.click(screen.getByLabelText('Select One'));
    fireEvent.click(screen.getByLabelText('Select Three'));
    fireEvent.click(screen.getByRole('button', { name: 'Set evaluators…' }));
    fireEvent.click(screen.getByLabelText('Selected evaluators'));
    fireEvent.click(screen.getByLabelText('Graded by matches-expected'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(evaluation.updateCase).toHaveBeenCalledTimes(2));
    expect(evaluation.updateCase).toHaveBeenCalledWith({ caseId: 'c-1', evaluatorIds: ['e-schema'] });
    expect(evaluation.updateCase).toHaveBeenCalledWith({ caseId: 'c-3', evaluatorIds: ['e-schema'] });
  });

  it('says what is wrong with an input that does not fit instead of sending it', () => {
    evaluation.updateCase.mockClear();
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Case input'), { target: { value: '{"triggerPayload": {}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByTestId('case-form').textContent).toContain('previousStepOutputs');
    expect(evaluation.updateCase).not.toHaveBeenCalled();
  });
});

describe('Adding an Eval Case by hand', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const withCases = (cases: unknown[]) => ({
    cases: { isLoading: false, data: { cases } },
    agentRuns: { data: { pages: [] }, hasNextPage: false },
    datasets: { data: { datasets: [] } },
    evaluators: { data: { evaluators: [] } },
  }) as never;

  it('starts from an existing case\'s input, so it keeps the shape the step is given, and its workspace', () => {
    const source = evalCaseOf({ workspaceSeedCommit: 'abc1234' });
    render(<CasesSection step={step} evaluation={withCases([source])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));

    expect(JSON.parse((screen.getByLabelText('Case input') as HTMLTextAreaElement).value)).toEqual(source.input);
    const input = { ...source.input, triggerPayload: { studyId: 'NOT-A-STUDY' } };
    fireEvent.change(screen.getByLabelText('Case input'), { target: { value: JSON.stringify(input) } });
    fireEvent.change(screen.getByLabelText('Case name'), { target: { value: 'Unknown study' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));

    expect(evaluation.createCase).toHaveBeenCalledWith({
      ...step, name: 'Unknown study', split: 'dev', input,
      expectedOutput: null, expectation: 'positive', comparison: 'exact', agreementInstructions: null, evaluatorIds: null,
      workspaceSeedCommit: 'abc1234', containsProductionData: true,
    });
  });

  it('takes the expected output beside the input', () => {
    evaluation.createCase.mockClear();
    render(<CasesSection step={step} evaluation={withCases([])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));
    fireEvent.change(screen.getByLabelText('Case name'), { target: { value: 'Fatal sepsis' } });
    fireEvent.change(screen.getByLabelText('Expected output'), { target: { value: '{"findings": [{"term": "Sepsis", "grade": 5}]}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));

    expect(evaluation.createCase).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Fatal sepsis', expectedOutput: { findings: [{ term: 'Sepsis', grade: 5 }] }, expectation: 'positive', comparison: 'exact',
    }));
  });

  it('says what is wrong with an expected output that is not JSON instead of sending it', () => {
    evaluation.createCase.mockClear();
    render(<CasesSection step={step} evaluation={withCases([])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));
    fireEvent.change(screen.getByLabelText('Case name'), { target: { value: 'Broken' } });
    fireEvent.change(screen.getByLabelText('Expected output'), { target: { value: '{grade: 5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));

    expect(screen.getByTestId('case-form').textContent).toContain('The expected output is not valid JSON.');
    expect(evaluation.createCase).not.toHaveBeenCalled();
  });

  it('fills the form from a .json file of a whole case', async () => {
    render(<CasesSection step={step} evaluation={withCases([])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));
    const written = { name: 'Grade 4 neutropenia', input: { triggerPayload: {}, previousStepOutputs: { 'extract-aes': { events: [] } } }, expectedOutput: { grade: 4 }, expectation: 'negative' };
    fireEvent.change(screen.getByLabelText('Case file'), { target: { files: [new File([JSON.stringify(written)], 'neutropenia.json', { type: 'application/json' })] } });

    await waitFor(() => expect((screen.getByLabelText('Case name') as HTMLInputElement).value).toBe('Grade 4 neutropenia'));
    expect(JSON.parse((screen.getByLabelText('Expected output') as HTMLTextAreaElement).value)).toEqual({ grade: 4 });
    expect((screen.getByLabelText('Negative — the output must not match') as HTMLInputElement).checked).toBe(true);
    expect(JSON.parse((screen.getByLabelText('Case input') as HTMLTextAreaElement).value)).toEqual(written.input);
  });

  it('refuses a file that is not a case or a case input', () => {
    expect(caseFromFile('{"events": []}')).toEqual({ error: expect.stringContaining('neither a case') });
    expect(caseFromFile('{"triggerPayload": {}, "previousStepOutputs": {}}')).toEqual({ values: { input: expect.any(String) } });
  });
});

describe('Freezing a Dataset', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const datasetOf = (version: number, caseIds: string[]) => ({
    ...step, id: `d-${version}`, version, caseIds, containsProductionData: true, createdBy: 'author-1', createdAt: '2026-09-24T09:00:00.000Z',
  });
  const withDatasets = (cases: unknown[], datasets: unknown[]) => ({
    cases: { isLoading: false, data: { cases } },
    agentRuns: { data: { pages: [] }, hasNextPage: false },
    datasets: { data: { datasets } },
    evaluators: { data: { evaluators: [] } },
  }) as never;

  it('tells cases added since the newest version from cases it has that are gone', () => {
    const drift = datasetDrift([evalCaseOf({ id: 'c-1' }), evalCaseOf({ id: 'c-3' })] as never, datasetOf(1, ['c-1', 'c-2']) as never);
    expect([...drift.unfrozen]).toEqual(['c-3']);
    expect(drift.dropped).toBe(1);
  });

  it('says an Eval Run runs a saved snapshot, and that nothing is saved yet', () => {
    render(<CasesSection step={step} evaluation={withDatasets([evalCaseOf({})], [])} mayEdit={true} />);

    const status = screen.getByTestId('dataset-status').textContent;
    expect(status).toContain('An Eval Run does not run the list above');
    expect(status).toContain('Nothing saved yet');
  });

  it('marks unsaved cases, enables Save and warns before the page is left', () => {
    render(<CasesSection step={step} evaluation={withDatasets([evalCaseOf({ id: 'c-2', name: 'Edited' }), evalCaseOf({ id: 'c-1' })], [datasetOf(1, ['c-1'])])} mayEdit={true} />);

    expect(screen.getByTestId('dataset-status').textContent).toContain('runs Dataset v1 (1 case(s)), which is behind the list: 1 case(s) added or edited since are not in it. Save to make v2.');
    expect(screen.getAllByTestId('eval-case-unsaved')).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it('has nothing to save when the newest version has every live case', () => {
    render(<CasesSection step={step} evaluation={withDatasets([evalCaseOf({ id: 'c-1' })], [datasetOf(2, ['c-1']), datasetOf(1, ['c-1'])])} mayEdit={true} />);

    expect(screen.getByTestId('dataset-status').textContent).toContain('The next Eval Run runs Dataset v2: all 1 live case(s)');
    expect(screen.queryByTestId('eval-case-unsaved')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
    expect(screen.getByTestId('dataset-versions').children).toHaveLength(2);
  });
});

describe('AcceptanceCriteriaSection', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const criteriaOf = (criteria: unknown) => ({ isLoading: false, data: { criteria: criteria === null ? null : { version: 2, criteria, origin: 'user', createdBy: 'author-1' } } }) as never;
  const qualificationOf = (status: string, changed: string[] = [], validation: Record<string, unknown> = { status: 'not_verified', evalRunId: null, reason: 'No Eval Run of version 1 has finished yet.', runInProgress: false }) => ({
    isLoading: false,
    data: {
      status, changed, validation, evaluatorsChanged: [], history: status === 'not_qualified' ? [] : [{}],
      qualification: status === 'not_qualified' ? null : {
        evalRunId: 'run-0000aaaa-0000-0000-0000-000000000000', variantId: 'champion', variantLabel: 'Current step', patch: {},
        fingerprint: { hash: 'f'.repeat(64) }, acceptanceCriteria: { critical: { minPassRate: 0.9 } }, mcpPolicy: {}, deviations: [],
        signature: { signerName: 'Dr Q', signedAt: '2026-09-30T10:00:00.000Z', meaning: 'Approved.', reauthentication: 'password' },
      },
    },
  }) as never;

  it.each([
    ['passed', 'Validation passed'],
    ['failed', 'Validation failed'],
    ['not_verified', 'Not verified'],
  ])('shows the validation from the newest Eval Run as one status icon — %s: %s, whether signed or not', (status, label) => {
    const validation = { status, evalRunId: 'run-0000aaaa-0000-0000-0000-000000000000', reason: 'Eval Run run-0000: critical missed.', runInProgress: false };
    render(<AcceptanceCriteriaSection step={step} criteria={criteriaOf({ critical: { minPassRate: 0.9 } })} qualification={qualificationOf('not_qualified', [], validation)} mayEdit={false} />);

    expect(screen.getByTestId('validation-status').textContent).toBe(label);
    expect(screen.queryByTestId('step-qualification')).toBeNull();
    fireEvent.click(screen.getByTestId('validation-status'));
    expect(screen.getByTestId('validation-reason').textContent).toContain('critical missed');
  });

  it('opens what the qualification rests on — its Eval Run, not a Brief — from the icon', () => {
    render(<AcceptanceCriteriaSection step={step} criteria={criteriaOf({ critical: { minPassRate: 0.9 } })} qualification={qualificationOf('stale', ['model'])} mayEdit={false} />);
    fireEvent.click(screen.getByTestId('validation-status'));

    expect(screen.getByTestId('step-qualification').textContent).toContain('Eval Run run-0000');
    expect(screen.getByTestId('step-qualification').textContent).not.toContain('Brief');
    expect(screen.getByTestId('qualification-changed').textContent).toContain('model');
  });

  it('keeps the thresholds out of sight until Set the threshold opens them', () => {
    render(<AcceptanceCriteriaSection step={step} criteria={criteriaOf({ critical: { minPassRate: 0.9 } })} qualification={qualificationOf('not_qualified')} mayEdit={true} />);

    expect(screen.queryByText('Acceptance Criteria')).toBeNull();
    expect(screen.queryByText(/v2/)).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByTestId('set-threshold'));
    expect(screen.getAllByRole('slider')).toHaveLength(3);
  });

  it('starts every severity at 100% until criteria are set', () => {
    render(<AcceptanceCriteriaSection step={step} criteria={criteriaOf(null)} qualification={qualificationOf('not_qualified')} mayEdit={true} />);
    fireEvent.click(screen.getByTestId('set-threshold'));

    for (const severity of ['critical', 'major', 'minor']) {
      expect((screen.getByLabelText(`${severity} minimum pass rate`) as HTMLInputElement).value).toBe('100');
    }
  });

  it('saves the tuned thresholds once, on Save, keeping a severity\'s pass^k', () => {
    evaluation.setAcceptanceCriteria.mockClear();
    render(<AcceptanceCriteriaSection step={step} criteria={criteriaOf({ critical: { minPassRate: 0.9, minPassHatK: 1 } })} qualification={qualificationOf('not_qualified')} mayEdit={true} />);
    fireEvent.click(screen.getByTestId('set-threshold'));

    fireEvent.change(screen.getByLabelText('critical minimum pass rate'), { target: { value: '95' } });
    fireEvent.click(screen.getByLabelText('judge minor'));
    fireEvent.change(screen.getByLabelText('minor minimum pass rate'), { target: { value: '50' } });
    expect(evaluation.setAcceptanceCriteria).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(evaluation.setAcceptanceCriteria).toHaveBeenCalledTimes(1);
    expect(evaluation.setAcceptanceCriteria).toHaveBeenCalledWith({ ...step, criteria: { critical: { minPassRate: 0.95, minPassHatK: 1 }, minor: { minPassRate: 0.5 } } });
  });

  it('cannot stop judging the only severity judged', () => {
    render(<AcceptanceCriteriaSection step={step} criteria={criteriaOf({ major: { minPassRate: 0.8 } })} qualification={qualificationOf('not_qualified')} mayEdit={true} />);
    fireEvent.click(screen.getByTestId('set-threshold'));

    expect((screen.getByLabelText('judge major') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('critical minimum pass rate') as HTMLInputElement).disabled).toBe(true);
  });

  it('drops a severity set to not judged', () => {
    expect(withPassRate({ critical: { minPassRate: 0.9 }, major: { minPassRate: 0.8 } }, 'major', '')).toEqual({ critical: { minPassRate: 0.9 } });
  });
});
