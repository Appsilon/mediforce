import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BriefSection, CasesSection, DriftAlert, EvaluatorsSection, McpPolicySection, caseFromFile, toEvaluatorName } from '../step-evaluation-sections';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
    reset: () => undefined,
  }),
}),);

const evaluation = vi.hoisted(() => ({
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

    expect(screen.getByText('Production runs to add (2+)')).toBeTruthy();
    expect(screen.getByTestId('harvestable-runs').textContent).toContain('Graded 3 events.');
    expect(screen.getByTestId('harvestable-runs').textContent).toContain('No events found.');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(fetchNextPage).toHaveBeenCalled();
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
