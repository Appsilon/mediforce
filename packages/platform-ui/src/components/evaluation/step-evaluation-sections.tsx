'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  CHAMPION_VARIANT_ID,
  EvaluatorSeveritySchema,
  describeAcceptanceCriteria,
  type AcceptanceCriteria,
  type EvaluatedStep,
  type EvaluatorCheck,
  type EvaluatorSeverity,
  type StepFingerprintComponent,
} from '@mediforce/platform-core';
import { EvalChallengerSchema, type EvalChallenger, type EvaluatorView, type PreparedEvalRun } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { useEvalRun, useStepEvaluation, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { EvalRunReport, describePatch } from './eval-run-report';
import { QualificationStatusChip } from './step-qualification-badge';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

type StepEvaluation = ReturnType<typeof useStepEvaluation>;

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Loading() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

/** The Step's context of use (D16), versioned on every save. */
export function BriefSection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['brief']; mayEdit: boolean }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const save = useStepEvaluationMutation(step, (text: string) => mediforce.evaluation.setBrief({ ...step, text }));
  const brief = data.data?.brief ?? null;
  return (
    <Section
      title="Evaluation Brief"
      action={mayEdit && draft === null && (
        <button type="button" className={buttonClass} onClick={() => setDraft(brief?.text ?? '')}>{brief === null ? 'Write' : 'Edit'}</button>
      )}
    >
      {data.isLoading ? <Loading /> : draft !== null ? (
        <div className="space-y-2">
          <textarea
            className={cn(inputClass, 'w-full min-h-24')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What this step is for, who relies on its output, which failures matter most."
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={draft.trim() === '' || save.isPending}
              onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}
            >Save as v{(brief?.version ?? 0) + 1}</button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : brief === null ? (
        <p className="text-sm text-muted-foreground">No Brief yet — the step&apos;s context of use is unstated. The assistant can draft one.</p>
      ) : (
        <div className="space-y-1">
          <MarkdownPresentation content={brief.text} />
          <p className="text-xs text-muted-foreground">v{brief.version} · {brief.origin === 'assistant' ? 'drafted by the assistant' : 'written'} by {brief.createdBy}</p>
        </div>
      )}
    </Section>
  );
}

const CHECK_TEMPLATES: Record<EvaluatorCheck['kind'], string> = {
  builtin: JSON.stringify({ kind: 'builtin', name: 'phi_leak' }, null, 2),
  schema: JSON.stringify({ kind: 'schema', schema: { required: [] } }, null, 2),
  code: JSON.stringify({
    kind: 'code',
    runtime: 'python',
    source: "import json\ndata = json.load(open('/output/input.json'))\njson.dump({'passed': True}, open('/output/result.json', 'w'))",
  }, null, 2),
  llm_judge: JSON.stringify({
    kind: 'llm_judge',
    model: 'anthropic/claude-sonnet-4',
    rubric: '',
    choices: [{ label: 'pass', value: 1 }, { label: 'fail', value: 0 }],
  }, null, 2),
};

function EvaluatorRow({ step, evaluator, mayEdit }: { step: EvaluatedStep; evaluator: EvaluatorView; mayEdit: boolean }) {
  const approve = useStepEvaluationMutation(step, () =>
    mediforce.evaluation.approveEvaluatorSource({ evaluatorId: evaluator.id, version: evaluator.latest.version }));
  const archive = useStepEvaluationMutation(step, () => mediforce.evaluation.archiveEvaluator({ evaluatorId: evaluator.id }));
  const production = useStepEvaluationMutation(step, (runInProduction: boolean) =>
    mediforce.evaluation.setEvaluatorProduction({ evaluatorId: evaluator.id, runInProduction }));
  const check = evaluator.latest.check;
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0" data-testid="evaluator-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm">
            <span className="font-medium">{evaluator.name}</span>
            <span className="ml-1.5 text-xs text-muted-foreground">v{evaluator.latest.version} · {check.kind} · {evaluator.latest.severity}{evaluator.latest.origin === 'assistant' ? ' · from the assistant' : ''}</span>
          </div>
          <p className="text-xs text-muted-foreground">{evaluator.latest.rule}</p>
          <span className={cn(
            'mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium',
            evaluator.trust.trusted ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>{evaluator.trust.trusted ? 'Counts' : `Not counted — ${evaluator.trust.reason}`}</span>
          <label className="mt-1.5 flex items-center gap-1.5 text-xs" data-testid="evaluator-production">
            <input
              type="checkbox"
              checked={evaluator.runInProduction}
              disabled={mayEdit === false || production.isPending}
              onChange={(event) => production.mutate(event.target.checked)}
            />
            <span>Also run in production</span>
            {evaluator.runInProduction && (
              <span className="text-muted-foreground" data-testid="evaluator-production-state">
                {evaluator.production.active ? '— scoring live runs' : `— ${evaluator.production.reason ?? 'not active'}`}
              </span>
            )}
          </label>
          {evaluator.latest.calibration !== null && (
            <span className="ml-1.5 text-[11px] text-muted-foreground">
              agreement {evaluator.latest.calibration.agreement.toFixed(2)}
              {typeof evaluator.latest.calibration.kappa === 'number' && ` · κ ${evaluator.latest.calibration.kappa.toFixed(2)}`}
              {' '}on {evaluator.latest.calibration.labelCount} labels
            </span>
          )}
        </div>
        {mayEdit && (
          <div className="flex shrink-0 gap-1.5">
            {check.kind === 'code' && evaluator.latest.sourceApproval === null && (
              <button type="button" className={buttonClass} disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>Approve source</button>
            )}
            <button type="button" className={buttonClass} disabled={archive.isPending} onClick={() => archive.mutate(undefined)}>Archive</button>
          </div>
        )}
      </div>
      {(check.kind === 'code' || check.kind === 'llm_judge') && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">{check.kind === 'code' ? 'Source' : 'Rubric'}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">{check.kind === 'code' ? check.source : check.rubric}</pre>
        </details>
      )}
    </li>
  );
}

/** The Step's Evaluators with whether each counts (D9); code source is approved here, by a person. */
export function EvaluatorsSection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['evaluators']; mayEdit: boolean }) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [rule, setRule] = React.useState('');
  const [severity, setSeverity] = React.useState<'critical' | 'major' | 'minor'>('major');
  const [kind, setKind] = React.useState<EvaluatorCheck['kind']>('schema');
  const [checkText, setCheckText] = React.useState(CHECK_TEMPLATES.schema);
  const [error, setError] = React.useState<string | null>(null);
  const create = useStepEvaluationMutation(step, (check: EvaluatorCheck) =>
    mediforce.evaluation.createEvaluator({ ...step, name, rule, severity, check }));

  const submit = () => {
    let check: EvaluatorCheck;
    try {
      check = JSON.parse(checkText) as EvaluatorCheck;
    } catch {
      setError('The check is not valid JSON.');
      return;
    }
    setError(null);
    create.mutate(check, {
      onSuccess: () => {
        setAdding(false);
        setName('');
        setRule('');
        setKind('schema');
        setCheckText(CHECK_TEMPLATES.schema);
      },
      onError: (err) => setError(err.message),
    });
  };

  const evaluators = data.data?.evaluators ?? [];
  return (
    <Section title="Evaluators" action={mayEdit && !adding && <button type="button" className={buttonClass} onClick={() => setAdding(true)}>Add</button>}>
      {data.isLoading ? <Loading /> : evaluators.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No Evaluators yet. Ask the assistant what to check, or add one.</p>
      ) : (
        <ul className="space-y-2">{evaluators.map((evaluator) => <EvaluatorRow key={evaluator.id} step={step} evaluator={evaluator} mayEdit={mayEdit} />)}</ul>
      )}
      {adding && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="flex gap-2">
            <input className={cn(inputClass, 'flex-1')} placeholder="name-in-kebab-case" value={name} onChange={(event) => setName(event.target.value)} />
            <select className={inputClass} value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
              <option value="critical">critical</option>
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
            <select
              className={inputClass}
              aria-label="Kind"
              value={kind}
              onChange={(event) => {
                const selected = event.target.value as EvaluatorCheck['kind'];
                setKind(selected);
                setCheckText(CHECK_TEMPLATES[selected]);
              }}
            >
              <option value="schema">schema</option>
              <option value="code">code</option>
              <option value="llm_judge">llm_judge</option>
            </select>
          </div>
          <input className={cn(inputClass, 'w-full')} placeholder="The rule, in plain language" value={rule} onChange={(event) => setRule(event.target.value)} />
          <textarea className={cn(inputClass, 'w-full min-h-32 font-mono text-xs')} value={checkText} onChange={(event) => setCheckText(event.target.value)} />
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className={primaryButtonClass} disabled={name === '' || rule === '' || create.isPending} onClick={submit}>Create</button>
            <button type="button" className={buttonClass} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Eval Cases, harvested from production runs or written by the assistant, and frozen Dataset versions. */
export function CasesSection({ step, evaluation, mayEdit }: { step: EvaluatedStep; evaluation: StepEvaluation; mayEdit: boolean }) {
  const harvest = useStepEvaluationMutation(step, (input: { agentRunId: string; expectation: 'positive' | 'negative' }) =>
    mediforce.evaluation.createCaseFromAgentRun(input));
  const freeze = useStepEvaluationMutation(step, () => mediforce.evaluation.freezeDataset(step));
  const cases = evaluation.cases.data?.cases ?? [];
  const harvested = new Set(cases.filter((evalCase) => evalCase.source === 'production').map((evalCase) => evalCase.sourceAgentRunId));
  const runs = (evaluation.agentRuns.data?.runs ?? []).filter((run) => !harvested.has(run.id));
  const [latest] = evaluation.datasets.data?.datasets ?? [];

  return (
    <Section
      title="Eval Cases"
      action={mayEdit && cases.length > 0 && (
        <button type="button" className={buttonClass} disabled={freeze.isPending} onClick={() => freeze.mutate(undefined)}>Freeze dataset</button>
      )}
    >
      {evaluation.cases.isLoading ? <Loading /> : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases yet. Add production runs below, or ask the assistant.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {cases.map((evalCase) => (
            <li key={evalCase.id} className="flex items-center gap-2">
              <span className={cn('rounded px-1.5 text-[11px]', evalCase.expectation === 'positive' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>{evalCase.expectation}</span>
              <span className="truncate">{evalCase.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{evalCase.split} · {evalCase.source}{evalCase.perturbation === null ? '' : ` (${evalCase.perturbation.kind.replace(/_/g, ' ')})`}{evalCase.origin === 'assistant' ? ' · from the assistant' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {latest !== undefined && (
        <p className="text-xs text-muted-foreground">Dataset v{latest.version} frozen with {latest.caseIds.length} case(s){latest.containsProductionData ? ' — contains production data' : ''}.</p>
      )}
      {mayEdit && runs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Recent production runs ({runs.length})</summary>
          <ul className="mt-2 space-y-1">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{run.id.slice(0, 8)}</span>
                <span className="text-muted-foreground">{run.status} · {run.startedAt.slice(0, 16).replace('T', ' ')}</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className={buttonClass} onClick={() => harvest.mutate({ agentRunId: run.id, expectation: 'positive' })}>Add as good</button>
                  <button type="button" className={buttonClass} onClick={() => harvest.mutate({ agentRunId: run.id, expectation: 'negative' })}>Add as bad</button>
                </span>
              </li>
            ))}
          </ul>
          {harvest.error !== null && <p className="mt-1 text-xs text-destructive">{harvest.error.message}</p>}
        </details>
      )}
    </Section>
  );
}

/** What each MCP server of the Step's agent may do in a trial (D6); unnamed servers are denied. */
export function McpPolicySection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['mcpPolicy']; mayEdit: boolean }) {
  const save = useStepEvaluationMutation(step, (servers: Record<string, { mode: 'live' | 'deny'; denyTools?: string[] }>) =>
    mediforce.evaluation.setMcpPolicy({ ...step, servers }));
  const servers = data.data?.servers ?? [];
  if (!data.isLoading && servers.length === 0) return null;
  const setMode = (name: string, mode: 'live' | 'deny') => {
    const next = Object.fromEntries(servers.filter((server) => !server.defaulted).map((server) => [
      server.name,
      { mode: server.mode, ...(server.denyTools === undefined ? {} : { denyTools: server.denyTools }) },
    ]));
    const denyTools = servers.find((server) => server.name === name)?.denyTools;
    next[name] = { mode, ...(denyTools === undefined ? {} : { denyTools }) };
    save.mutate(next);
  };
  return (
    <Section title="MCP servers in eval trials">
      {data.isLoading ? <Loading /> : (
        <ul className="space-y-1 text-sm">
          {servers.map((server) => (
            <li key={server.name} className="flex items-center gap-2">
              <span className="font-mono text-xs">{server.name}</span>
              {server.denyTools !== undefined && server.denyTools.length > 0 && (
                <span className="text-xs text-muted-foreground">denied tools: {server.denyTools.join(', ')}</span>
              )}
              <select
                className={cn(inputClass, 'ml-auto text-xs')}
                value={server.mode}
                disabled={!mayEdit || save.isPending}
                onChange={(event) => setMode(server.name, event.target.value as 'live' | 'deny')}
              >
                <option value="deny">deny{server.defaulted ? ' (default)' : ''}</option>
                <option value="live">live</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const SEVERITIES = EvaluatorSeveritySchema.options;

type CriteriaDraft = Record<EvaluatorSeverity, { minPassRate: string; minPassHatK: string }>;

function toDraft(criteria: AcceptanceCriteria | undefined): CriteriaDraft {
  const field = (value: number | undefined) => (value === undefined ? '' : String(value));
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, {
    minPassRate: field(criteria?.[severity]?.minPassRate),
    minPassHatK: field(criteria?.[severity]?.minPassHatK),
  }])) as CriteriaDraft;
}

function fromDraft(draft: CriteriaDraft): AcceptanceCriteria {
  return Object.fromEntries(SEVERITIES.flatMap((severity) => {
    const { minPassRate, minPassHatK } = draft[severity];
    if (minPassRate.trim() === '') return [];
    return [[severity, { minPassRate: Number(minPassRate), ...(minPassHatK.trim() === '' ? {} : { minPassHatK: Number(minPassHatK) }) }]];
  })) as AcceptanceCriteria;
}

/**
 * The floors Eval Runs are judged against (D10): per severity, the minimum
 * pass rate on its Wilson 95% lower bound and optionally pass^k. Each save is
 * a version; the next run prepared freezes the one in force.
 */
export function AcceptanceCriteriaSection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['criteria']; mayEdit: boolean }) {
  const [draft, setDraft] = React.useState<CriteriaDraft | null>(null);
  const save = useStepEvaluationMutation(step, (criteria: AcceptanceCriteria) => mediforce.evaluation.setAcceptanceCriteria({ ...step, criteria }));
  const current = data.data?.criteria ?? null;
  return (
    <Section
      title="Acceptance Criteria"
      action={mayEdit && draft === null && (
        <button type="button" className={buttonClass} onClick={() => setDraft(toDraft(current?.criteria))}>{current === null ? 'Set' : 'Edit'}</button>
      )}
    >
      {data.isLoading ? <Loading /> : draft !== null ? (
        <div className="space-y-2" data-testid="acceptance-criteria-form">
          <p className="text-xs text-muted-foreground">Minimum pass rate on the Wilson 95% lower bound, and optionally pass^k, that every counted Evaluator of the severity must reach. Leave a severity empty not to judge it.</p>
          {SEVERITIES.map((severity) => (
            <div key={severity} className="flex items-center gap-2 text-xs">
              <span className="w-14">{severity}</span>
              <input
                aria-label={`${severity} minimum pass rate`}
                type="number" min={0} max={1} step={0.01} placeholder="—"
                className={cn(inputClass, 'w-20')}
                value={draft[severity].minPassRate}
                onChange={(event) => setDraft({ ...draft, [severity]: { ...draft[severity], minPassRate: event.target.value } })}
              />
              <span className="text-muted-foreground">pass^k</span>
              <input
                aria-label={`${severity} minimum pass^k`}
                type="number" min={0} max={1} step={0.01} placeholder="—"
                className={cn(inputClass, 'w-20')}
                value={draft[severity].minPassHatK}
                onChange={(event) => setDraft({ ...draft, [severity]: { ...draft[severity], minPassHatK: event.target.value } })}
              />
            </div>
          ))}
          {save.error !== null && <p className="text-xs text-destructive">{save.error.message}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={SEVERITIES.every((severity) => draft[severity].minPassRate.trim() === '') || save.isPending}
              onClick={() => save.mutate(fromDraft(draft), { onSuccess: () => setDraft(null) })}
            >Save as v{(current?.version ?? 0) + 1}</button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : current === null ? (
        <p className="text-sm text-muted-foreground">No Acceptance Criteria yet — Eval Runs judge nothing until they are set. The assistant can propose them from the step&apos;s risks.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-sm" data-testid="acceptance-criteria">{describeAcceptanceCriteria(current.criteria)}</p>
          <p className="text-xs text-muted-foreground">v{current.version} · {current.origin === 'assistant' ? 'proposed by the assistant' : 'set'} by {current.createdBy}</p>
        </div>
      )}
    </Section>
  );
}

const COMPONENT_LABELS: Record<StepFingerprintComponent, string> = {
  step: 'step config',
  model: 'model',
  systemPrompt: 'agent system prompt',
  skill: 'skill',
  image: 'image',
  mcpServers: 'MCP servers',
  preamble: 'workflow preamble',
};

/**
 * The Step's qualification (D10, D11): whether a signed Step Qualification
 * binds the step as it is now, what it cites, and — when stale — what changed.
 * A person signs one from an Eval Run's report below.
 */
export function QualificationSection({ data }: { data: StepEvaluation['qualification'] }) {
  const status = data.data;
  const qualification = status?.qualification ?? null;
  return (
    <Section title="Step Qualification" action={status !== undefined && <QualificationStatusChip status={status.status} />}>
      {data.isLoading || status === undefined ? <Loading /> : qualification === null ? (
        <p className="text-sm text-muted-foreground">
          Not qualified. Set Acceptance Criteria, run the step, and sign a Step Qualification from the run&apos;s report. It is informational: nothing is blocked without one.
        </p>
      ) : (
        <div className="space-y-1.5 text-xs" data-testid="step-qualification">
          <p>
            Signed by <span className="font-medium">{qualification.signature.signerName}</span> on {qualification.signature.signedAt.slice(0, 16).replace('T', ' ')}
            {' '}for {qualification.variantId === CHAMPION_VARIANT_ID ? 'the step' : `'${qualification.variantLabel}' (${describePatch(qualification.patch)})`}
            {' '}— Eval Run <span className="font-mono">{qualification.evalRunId.slice(0, 8)}</span>, Brief v{qualification.briefVersion},
            {' '}fingerprint <span className="font-mono">{qualification.fingerprint.hash.slice(0, 12)}</span>.
          </p>
          <p className="text-muted-foreground">{qualification.signature.meaning} ({qualification.signature.reauthentication === 'password' ? 'password re-entered' : 'signed from the session'})</p>
          <p>Criteria: {describeAcceptanceCriteria(qualification.acceptanceCriteria)}</p>
          {qualification.deviations.map((deviation) => (
            <p key={deviation.severity} className="text-amber-700 dark:text-amber-300">Deviation ({deviation.severity}): {deviation.justification}</p>
          ))}
          {status.status === 'stale' && (
            <p className="text-amber-700 dark:text-amber-300" data-testid="qualification-changed">
              The step changed since: {status.changed.map((component) => COMPONENT_LABELS[component]).join(', ')}.
            </p>
          )}
          {status.evaluatorsChanged.length > 0 && (
            <p className="text-muted-foreground" data-testid="qualification-evaluators-changed">Evaluators changed since: {status.evaluatorsChanged.join('; ')}.</p>
          )}
          {status.history.length > 1 && <p className="text-muted-foreground">{status.history.length} qualifications signed for this step.</p>}
        </div>
      )}
    </Section>
  );
}

/**
 * The card a prepared Eval Run waits on: the person starts it by confirming
 * the budget shown (D15). The only place `confirmedBudgetUsd` is sent from.
 */
export function StartEvalRunCard({ step, prepared, mayRun, runReason }: {
  step: EvaluatedStep;
  prepared: PreparedEvalRun;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const start = useStepEvaluationMutation(step, () =>
    mediforce.evaluation.startRun({ evalRunId: prepared.evalRunId, confirmedBudgetUsd: prepared.budgetUsd }));
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="start-eval-run-card">
      <p>
        Eval Run of {prepared.trials} trial(s)
        {prepared.estimatedUsd === null ? ' — no cost estimate' : ` — estimated $${prepared.estimatedUsd}`}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <InstantTooltip label={runReason}>
          <span className="inline-flex">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!mayRun || start.isPending || start.isSuccess}
              onClick={() => start.mutate(undefined)}
            >
              {start.isSuccess ? 'Started' : `Start — spend up to $${prepared.budgetUsd}`}
            </button>
          </span>
        </InstantTooltip>
        {start.error !== null && <span className="text-xs text-destructive">{start.error.message}</span>}
      </div>
    </div>
  );
}

function EvalRunRow({ step, evalRunId, onOpen, open, mayEdit, editReason }: {
  step: EvaluatedStep;
  evalRunId: string;
  onOpen: () => void;
  open: boolean;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const run = useEvalRun(open ? evalRunId : null);
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0">
      <button type="button" className="text-left text-xs font-mono hover:underline" onClick={onOpen}>{evalRunId.slice(0, 8)}</button>
      {open && (run.data === undefined ? <Loading /> : (
        <div className="mt-2"><EvalRunReport output={run.data} step={step} mayEdit={mayEdit} editReason={editReason} /></div>
      ))}
    </li>
  );
}

const CHALLENGERS_TEMPLATE = JSON.stringify([{ label: 'Another model', patch: { model: 'openai/gpt-5' } }], null, 2);

/**
 * Prepare, confirm and read the Step's Eval Runs — the step as it is and any
 * challengers patched over it. Preparing and starting one is the workflow's
 * `run` verb; signing a qualification from a report is its `edit` verb.
 */
export function EvalRunsSection({ step, data, mayRun, runReason, mayEdit, editReason }: {
  step: EvaluatedStep;
  data: StepEvaluation['runs'];
  mayRun: boolean;
  runReason: string | undefined;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const [trials, setTrials] = React.useState(3);
  const [budget, setBudget] = React.useState('');
  const [challengers, setChallengers] = React.useState<string | null>(null);
  const [challengersError, setChallengersError] = React.useState<string | null>(null);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const prepare = useStepEvaluationMutation(step, (variants: EvalChallenger[]) => mediforce.evaluation.prepareRun({
    ...step,
    trialsPerCase: trials,
    challengers: variants,
    ...(budget === '' ? {} : { budgetUsd: Number(budget) }),
  }));
  const submit = () => {
    let variants: EvalChallenger[] = [];
    if (challengers !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(challengers);
      } catch {
        setChallengersError('The challengers are not valid JSON.');
        return;
      }
      const checked = EvalChallengerSchema.array().safeParse(parsed);
      if (checked.success === false) {
        setChallengersError(`The challengers do not fit: ${checked.error.issues.map((issue) => `${issue.path.length === 0 ? 'list' : issue.path.join('.')} — ${issue.message}`).join('; ')}`);
        return;
      }
      variants = checked.data;
    }
    setChallengersError(null);
    prepare.mutate(variants);
  };
  const prepareError = challengersError ?? prepare.error?.message ?? null;
  const runs = data.data?.evalRuns ?? [];
  // Prepared here, by the assistant or from the CLI: each waits for a person to confirm its budget.
  const waiting: PreparedEvalRun[] = runs.filter((run) => run.status === 'prepared').map((run) => ({
    evalRunId: run.id,
    budgetUsd: run.budgetUsd,
    estimatedUsd: run.estimate.totalUsd,
    trials: run.caseIds.length * run.trialsPerCase * run.variants.length,
  }));

  return (
    <Section title="Eval Runs">
      {mayRun && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Trials per case
            <input type="number" min={1} max={10} className={cn(inputClass, 'w-16')} value={trials} onChange={(event) => setTrials(Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-1">Budget $
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'w-24')} placeholder="auto" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <button type="button" className={buttonClass} onClick={() => setChallengers(challengers === null ? CHALLENGERS_TEMPLATE : null)}>
            {challengers === null ? 'Add challengers' : 'No challengers'}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={prepare.isPending}
            onClick={submit}
          >Prepare</button>
          {prepareError !== null && <span className="text-destructive">{prepareError}</span>}
        </div>
      )}
      {mayRun && challengers !== null && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            Up to three challengers run beside the step as it is, each a patch: model, prompt, skillCommit or allowedTools replace the step&apos;s own; mcpRestrictions narrow it. Every variant runs every case.
          </p>
          <textarea
            aria-label="Challengers"
            className={cn(inputClass, 'w-full min-h-24 font-mono text-xs')}
            value={challengers}
            onChange={(event) => setChallengers(event.target.value)}
          />
        </div>
      )}
      {waiting.map((run) => <StartEvalRunCard key={run.evalRunId} step={step} prepared={run} mayRun={mayRun} runReason={runReason} />)}
      {data.isLoading ? <Loading /> : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Eval Runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="text-sm">
              <span className="text-xs text-muted-foreground">
                {run.createdAt.slice(0, 16).replace('T', ' ')} · {run.status} · ${run.spentUsd.toFixed(2)} of ${run.budgetUsd}
                {run.variants.length > 1 && ` · ${run.variants.length} variants`}
              </span>
              <ul>
                <EvalRunRow
                  step={step}
                  evalRunId={run.id}
                  open={openRunId === run.id}
                  onOpen={() => setOpenRunId(openRunId === run.id ? null : run.id)}
                  mayEdit={mayEdit}
                  editReason={editReason}
                />
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
