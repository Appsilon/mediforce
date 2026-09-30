import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BriefSection, CasesSection, DriftAlert, EvaluatorsSection, McpPolicySection, caseFromFile, datasetDrift, toEvaluatorName } from '../step-evaluation-sections';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useAgentRunIo: (agentRunId: string | null) => ({
    isError: false,
    error: null,
    data: agentRunId === null ? undefined : { agentRunId, status: 'completed', stepInput: { narrative: `input of ${agentRunId}` }, result: { grade: `output of ${agentRunId}` }, reasoningSummary: null, confidence: null },
  }),
  useEvaluatorLabels: () => ({ data: { labels: judgeLabels } }),
  useWrittenOutputs: () => ({ data: { writtenOutputs: writtenOutputs } }),
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
    reset: () => undefined,
  }),
}),);

const judgeLabels = vi.hoisted((): unknown[] => []);
const writtenOutputs = vi.hoisted((): unknown[] => []);

const evaluation = vi.hoisted(() => ({
  labelOutput: vi.fn(),
  calibrateEvaluator: vi.fn(),
  setBrief: vi.fn(),
  createEvaluator: vi.fn(),
  addEvaluatorVersion: vi.fn(),
  createRedTeamCases: vi.fn(),
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
  expectation: 'positive',
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
    check: { kind: 'llm_judge', model: 'anthropic/claude-sonnet-4', rubric: 'Is every grade justified?', choices: [{ label: 'pass', value: 1 }, { label: 'fail', value: 0 }] },
    origin: 'user', sourceApproval: null, calibration: null, createdBy: 'author-1', createdAt: '2026-09-24T08:00:00.000Z',
  };
  const evaluator = {
    ...step, id: version.evaluatorId, name: 'grades-justified', archived: false, runInProduction: false,
    createdBy: 'author-1', createdAt: '2026-09-24T08:00:00.000Z',
    latest: version, versions: [version], trust: { trusted: false, reason: 'not calibrated' }, production: { active: false },
  };
  const renderRow = () => render(<EvaluatorsSection step={step} data={{ isLoading: false, data: { evaluators: [evaluator] } } as never} mayEdit={true} />);

  it('shows what the check does', () => {
    renderRow();

    const details = screen.getByTestId('evaluator-details');
    expect(details.textContent).toContain('Is every grade justified?');
    expect(details.textContent).toContain('anthropic/claude-sonnet-4');
    expect(details.textContent).toContain('fail — 0 (fails)');
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

describe('Built-in case suites', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const run = { id: 'run-00000001', status: 'completed', fallbackReason: null, envelope: null, startedAt: '2026-09-24T08:00:00.000Z' };
  const stepEvaluation = (evaluators: unknown[]) => ({
    cases: { isLoading: false, data: { cases: [] } },
    agentRuns: { data: { pages: [{ runs: [run] }] }, hasNextPage: false },
    datasets: { data: { datasets: [] } },
    evaluators: { data: { evaluators } },
  }) as never;

  it('says which built-in Evaluator grades a suite, and that the step lacks it', () => {
    render(<CasesSection step={step} evaluation={stepEvaluation([])} mayEdit={true} />);

    expect(screen.getByTestId('builtin-suite-grader').textContent).toContain('Ignores injected instructions');
    expect(screen.getByTestId('builtin-suite-grader').textContent).toContain('this step has none yet');
  });

  it('adds the missing grading Evaluator from the suite', () => {
    evaluation.createEvaluator.mockClear();
    render(<CasesSection step={step} evaluation={stepEvaluation([])} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }));

    expect(evaluation.createEvaluator).toHaveBeenCalledWith({
      ...step, name: 'injection-ignored', rule: 'Ignores injected instructions', severity: 'major', check: { kind: 'builtin', name: 'injection_ignored' },
    });
  });

  it('warns when the run already has the suite for that field', () => {
    const evaluationWithCase = {
      ...(stepEvaluation([]) as object),
      cases: { isLoading: false, data: { cases: [evalCaseOf({ name: "Injection: direct override in 'triggerPayload.narrative'", source: 'synthesized', sourceAgentRunId: run.id, perturbation: { kind: 'injected_instruction', description: 'x', canary: 'CANARY-1' } })] } },
    } as never;
    render(<CasesSection step={step} evaluation={evaluationWithCase} mayEdit={true} />);
    expect(screen.queryByTestId('builtin-suite-duplicate')).toBeNull();

    fireEvent.change(screen.getByLabelText('Field path'), { target: { value: 'narrative' } });
    expect(screen.getByTestId('builtin-suite-duplicate').textContent).toContain('already has 1 prompt injection case(s)');
  });

  it('writes a suite from a run and a field of its input', () => {
    render(<CasesSection step={step} evaluation={stepEvaluation([{ latest: { check: { kind: 'builtin', name: 'result_stable' } } }])} mayEdit={true} />);
    fireEvent.change(screen.getByLabelText('Suite'), { target: { value: 'robustness' } });
    expect(screen.getByTestId('builtin-suite-grader').textContent).not.toContain('none yet');
    fireEvent.change(screen.getByLabelText('Field path'), { target: { value: 'document.text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add suite cases' }));

    expect(evaluation.createRedTeamCases).toHaveBeenCalledWith({
      ...step, suite: 'robustness', baseAgentRunId: run.id, target: { part: 'triggerPayload', path: ['document', 'text'] },
    });
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
    expect(screen.getByRole('button', { name: 'Positive case' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Negative case' })).toBeTruthy();
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

  it('shows the input and output of the run a production case was marked from', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({ expectation: 'negative' }))} mayEdit={false} />);
    const details = screen.getByTestId('eval-case-details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));

    expect(details.textContent).toContain('The run you marked negative');
    expect(screen.getByTestId('run-output').textContent).toContain('output of run-00000001');
  });

  it('saves only what changed', () => {
    render(<CasesSection step={step} evaluation={withCase(evalCaseOf({}))} mayEdit={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Expectation'), { target: { value: 'negative' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Grades the fatal event below 5.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(evaluation.updateCase).toHaveBeenCalledWith({ caseId: 'c-1', expectation: 'negative', notes: 'Grades the fatal event below 5.' });
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
    fireEvent.change(screen.getByLabelText('Expectation'), { target: { value: 'negative' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));

    expect(evaluation.createCase).toHaveBeenCalledWith({
      ...step, name: 'Unknown study', expectation: 'negative', split: 'dev', notes: null, input,
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

describe('Labelling a judge from the Evaluators section', () => {
  const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
  const judge = {
    id: 'judge-1', name: 'rationale-grounded', archived: false, runInProduction: false, production: { active: false, reason: null },
    trust: { trusted: false, reason: 'not calibrated' },
    latest: {
      version: 1, rule: 'The rationale cites the labs.', severity: 'major', origin: 'user', sourceApproval: null, calibration: null,
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Cited?', choices: [{ label: 'yes', value: 1 }, { label: 'no', value: 0 }] },
      createdBy: 'author-1', createdAt: '2026-09-24T08:00:00.000Z',
    },
    versions: [],
  };
  const run = (id: string) => ({ id, status: 'completed', fallbackReason: null, startedAt: '2026-09-24T08:00:00.000Z', envelope: null });

  function openPanel(cases: unknown[], runs: unknown[]) {
    render(<EvaluatorsSection step={step} data={{ isLoading: false, data: { evaluators: [judge] } } as never} mayEdit={true} labelCandidates={{ cases, runs } as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Label outputs' }));
  }

  it('shows how far the judge is from counting', () => {
    judgeLabels.splice(0, judgeLabels.length, { subject: { type: 'agent_run', id: 'run-a' }, value: 0, comment: null });
    render(<EvaluatorsSection step={step} data={{ isLoading: false, data: { evaluators: [judge] } } as never} mayEdit={false} />);

    expect(screen.getByTestId('calibration-progress').textContent).toBe('1/10 labels · 1/2 fails · not calibrated');
    judgeLabels.splice(0, judgeLabels.length);
  });

  it('offers the runs added as Eval Cases first, negatives first, and leaves out outputs already labelled', () => {
    judgeLabels.splice(0, judgeLabels.length, { subject: { type: 'agent_run', id: 'run-labelled' }, value: 1, comment: null });
    openPanel(
      [
        evalCaseOf({ id: 'c-1', expectation: 'positive', sourceAgentRunId: 'run-good' }),
        evalCaseOf({ id: 'c-2', expectation: 'negative', sourceAgentRunId: 'run-bad' }),
        evalCaseOf({ id: 'c-3', expectation: 'negative', sourceAgentRunId: 'run-labelled' }),
      ],
      [run('run-good'), run('run-other')],
    );

    const marked = screen.getByTestId('label-candidates-marked').querySelectorAll('[data-testid="label-output"]');
    expect([...marked].map((row) => row.textContent)).toEqual([
      expect.stringContaining('you added it as a negative case'),
      expect.stringContaining('you added it as a positive case'),
    ]);
    expect(marked[0]!.textContent).toContain('run-bad');
    expect(screen.getByTestId('label-candidates-runs').textContent).toContain('run-othe');
    expect(screen.getByTestId('label-candidates-runs').textContent).not.toContain('run-good');
    expect(screen.getByTestId('labelled-outputs').textContent).toContain('labelled pass');
    judgeLabels.splice(0, judgeLabels.length);
  });

  it('lists written examples with what they changed and their label, apart from the production outputs', () => {
    writtenOutputs.splice(0, writtenOutputs.length, {
      id: 'w-1', basedOnAgentRunId: 'run-base', stepInput: { narrative: 'x' }, result: { grade: 'output of run-base, edited' },
      note: 'Grade 4 written as 2.', origin: 'user', archived: false,
    });
    judgeLabels.splice(0, judgeLabels.length, { subject: { type: 'written_output', id: 'w-1' }, value: 0, comment: null });
    openPanel([], []);

    const row = screen.getByTestId('written-output');
    expect(row.textContent).toContain('labelled fail');
    expect(row.textContent).toContain('Grade 4 written as 2.');
    expect(screen.getByTestId('written-output-changes').textContent).toBe('Changed: grade: "output of run-base" → "output of run-base, edited"');
    expect(screen.queryByTestId('labelled-outputs')).toBeNull();
    expect(screen.getByTestId('calibration-progress').textContent).toContain('1/10 labels · 1/2 fails');
    fireEvent.click([...row.querySelectorAll('button')].find((button) => button.textContent === 'Pass')!);
    expect(evaluation.labelOutput).toHaveBeenCalledWith({ evaluatorId: 'judge-1', writtenOutputId: 'w-1', passed: true });
    writtenOutputs.splice(0, writtenOutputs.length);
    judgeLabels.splice(0, judgeLabels.length);
  });

  it('labels an output for the judge\'s rule', () => {
    openPanel([evalCaseOf({ expectation: 'negative', sourceAgentRunId: 'run-bad' })], []);
    const row = screen.getByTestId('label-candidates-marked').querySelector('[data-testid="label-output"]') as HTMLElement;
    fireEvent.change(row.querySelector('input')!, { target: { value: 'Grade not tied to ANC.' } });
    fireEvent.click([...row.querySelectorAll('button')].find((button) => button.textContent === 'Fail')!);

    expect(evaluation.labelOutput).toHaveBeenCalledWith({ evaluatorId: 'judge-1', agentRunId: 'run-bad', passed: false, comment: 'Grade not tied to ANC.' });
  });
});
