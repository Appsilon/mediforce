import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AcceptanceCriteriaSection, CasesSection, DriftAlert, EvaluatorsSection, McpPolicySection, caseFromFile, datasetDrift, toEvaluatorName, withPassRate } from '../step-evaluation-sections';

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

vi.mock('@/components/agents/agent-log-panel', () => ({
  AgentLogPanel: ({ run }: { run: { id: string } | null }) => (run === null ? null : <div data-testid="agent-log-panel">{run.id}</div>),
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
  notes: 'A fatal event is grade 5.',
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

describe('McpPolicySection', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const server = { name: 'meddra', mode: 'deny', defaulted: true, recordedCaseIds: [] };

  it('says what the mode each server is in does in a trial', () => {
    render(<McpPolicySection step={step} data={{ isLoading: false, data: { servers: [server, { ...server, name: 'ctcae', mode: 'replay', defaulted: false }] } } as never} mayEdit={true} />);

    const [meddra, ctcae] = screen.getAllByTestId('mcp-policy-server');
    expect(meddra!.textContent).toContain('cannot use this server during a trial');
    expect(ctcae!.textContent).toContain('answered from what a live trial of that case recorded');
    expect(ctcae!.textContent).toContain('runs live once and records it');
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

describe('Production runs to add as Eval Cases', () => {
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

  it('lists every loaded page with what each run did, and loads more on request', () => {
    const fetchNextPage = vi.fn();
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-a', 'Graded 3 events.')], [agentRun('run-b', 'No events found.')]], { hasNextPage: true, fetchNextPage })} mayEdit={true} />);

    expect(screen.getByText('Production runs to add as Eval Cases (2+)')).toBeTruthy();
    expect(screen.getByTestId('harvestable-runs').textContent).toContain('Graded 3 events.');
    expect(screen.getByTestId('harvestable-runs').textContent).toContain('No events found.');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('shows a run\'s input and output before it is added, fetched only when opened', () => {
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-a', 'Graded 3 events.')]], { hasNextPage: false })} mayEdit={true} />);
    expect(screen.queryByTestId('run-input-output')).toBeNull();

    const details = screen.getByText('Input and output').closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByTestId('run-input').textContent).toContain('input of run-a');
    expect(screen.getByTestId('run-output').textContent).toContain('output of run-a');
    fireEvent.click(screen.getByRole('button', { name: 'Add as case' }));
    expect(evaluation.createCaseFromAgentRun).toHaveBeenCalledWith({ agentRunId: 'run-a' });
  });

  it('opens a run\'s log', () => {
    render(<CasesSection step={step} evaluation={withRuns([[agentRun('run-a', 'Graded 3 events.')]], { hasNextPage: false })} mayEdit={true} />);

    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByTestId('agent-log-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    expect(screen.getByTestId('agent-log-panel').textContent).toBe('run-a');
  });
});

describe('Eval Case view and edit', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const withCase = (evalCase: unknown) => ({
    cases: { isLoading: false, data: { cases: [evalCase] } },
    agentRuns: { data: { pages: [] }, hasNextPage: false },
    datasets: { data: { datasets: [] } },
    evaluators: { data: { evaluators: [] } },
  }) as never;

  it('shows what a case gives the step and what it expects, and opens its source run\'s log', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={false} />);

    const details = screen.getByTestId('eval-case-details');
    expect(details.textContent).toContain('A fatal event is grade 5.');
    expect(details.textContent).toContain('"studyId": "CDISCPILOT01"');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Source run log' }));
    expect(screen.getByTestId('agent-log-panel').textContent).toBe('run-00000001');
  });

  it('shows the input and output of the run a production case came from', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={false} />);
    const details = screen.getByTestId('eval-case-details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));

    expect(details.textContent).toContain('The source run');
    expect(screen.getByTestId('run-output').textContent).toContain('output of run-00000001');
  });

  it('saves only what changed', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Must not grade the fatal event below 5.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(evaluation.updateCase).toHaveBeenCalledWith({ caseId: 'c-1', notes: 'Must not grade the fatal event below 5.' });
    expect(screen.queryByLabelText('Expectation')).toBeNull();
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

describe('Writing an Eval Case', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Write a case' }));

    expect(JSON.parse((screen.getByLabelText('Case input') as HTMLTextAreaElement).value)).toEqual(source.input);
    const input = { ...source.input, triggerPayload: { studyId: 'NOT-A-STUDY' } };
    fireEvent.change(screen.getByLabelText('Case input'), { target: { value: JSON.stringify(input) } });
    fireEvent.change(screen.getByLabelText('Case name'), { target: { value: 'Unknown study' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));

    expect(evaluation.createCase).toHaveBeenCalledWith({
      ...step, name: 'Unknown study', split: 'dev', notes: null, input,
      workspaceSeedCommit: 'abc1234', containsProductionData: true,
    });
  });

  it('fills the form from a .json file of a whole case', async () => {
    render(<CasesSection step={step} evaluation={withCases([])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Write a case' }));
    const written = { name: 'Grade 4 neutropenia', input: { triggerPayload: {}, previousStepOutputs: { 'extract-aes': { events: [] } } }, expectation: 'positive', notes: 'ANC < 0.5 is grade 4.' };
    fireEvent.change(screen.getByLabelText('Case file'), { target: { files: [new File([JSON.stringify(written)], 'neutropenia.json', { type: 'application/json' })] } });

    await waitFor(() => expect((screen.getByLabelText('Case name') as HTMLInputElement).value).toBe('Grade 4 neutropenia'));
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('ANC < 0.5 is grade 4.');
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

  it('says an Eval Run runs a frozen snapshot, and that nothing is frozen yet', () => {
    render(<CasesSection step={step} evaluation={withDatasets([evalCaseOf({})], [])} mayEdit={true} />);

    const status = screen.getByTestId('dataset-status').textContent;
    expect(status).toContain('An Eval Run does not run the list above');
    expect(status).toContain('Nothing frozen yet');
  });

  it('marks the cases the next Eval Run will not run until the next freeze', () => {
    render(<CasesSection step={step} evaluation={withDatasets([evalCaseOf({ id: 'c-2', name: 'Edited' }), evalCaseOf({ id: 'c-1' })], [datasetOf(1, ['c-1'])])} mayEdit={true} />);

    expect(screen.getByTestId('dataset-status').textContent).toContain('runs Dataset v1 (1 case(s)), which is behind the list: 1 case(s) added or edited since are not in it. Freeze to make v2.');
    expect(screen.getAllByTestId('eval-case-unfrozen')).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Freeze dataset' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('has nothing to freeze when the newest version has every live case', () => {
    render(<CasesSection step={step} evaluation={withDatasets([evalCaseOf({ id: 'c-1' })], [datasetOf(2, ['c-1']), datasetOf(1, ['c-1'])])} mayEdit={true} />);

    expect(screen.getByTestId('dataset-status').textContent).toContain('The next Eval Run runs Dataset v2: all 1 live case(s)');
    expect(screen.queryByTestId('eval-case-unfrozen')).toBeNull();
    expect((screen.getByRole('button', { name: 'Freeze dataset' }) as HTMLButtonElement).disabled).toBe(true);
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
