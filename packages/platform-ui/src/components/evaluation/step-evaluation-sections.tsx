'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import type { EvaluatedStep, EvaluatorCheck } from '@mediforce/platform-core';
import type { EvaluatorView, PreparedEvalRun } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useEvalRun, useStepEvaluation, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { EvalRunReport } from './eval-run-report';

type StepEvaluation = ReturnType<typeof useStepEvaluation>;

const buttonClass = 'rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:pointer-events-none';
const primaryButtonClass = 'rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none';
const inputClass = 'rounded-md border bg-background px-2 py-1 text-sm';

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
          <p className="text-sm whitespace-pre-wrap">{brief.text}</p>
          <p className="text-xs text-muted-foreground">v{brief.version} · {brief.origin === 'assistant' ? 'drafted by the assistant' : 'written'} by {brief.createdBy}</p>
        </div>
      )}
    </Section>
  );
}

const CHECK_TEMPLATES: Record<EvaluatorCheck['kind'], string> = {
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
      {check.kind !== 'schema' && (
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
      onSuccess: () => { setAdding(false); setName(''); setRule(''); },
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
              onChange={(event) => setCheckText(CHECK_TEMPLATES[event.target.value as EvaluatorCheck['kind']])}
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
  const harvested = new Set(cases.map((evalCase) => evalCase.sourceAgentRunId));
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
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{evalCase.split} · {evalCase.source}</span>
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
    next[name] = { mode };
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

/**
 * The card a prepared Eval Run waits on: the person starts it by confirming
 * the budget shown (D15). The only place `confirmedBudgetUsd` is sent from.
 */
export function StartEvalRunCard({ step, prepared }: { step: EvaluatedStep; prepared: PreparedEvalRun }) {
  const start = useStepEvaluationMutation(step, () =>
    mediforce.evaluation.startRun({ evalRunId: prepared.evalRunId, confirmedBudgetUsd: prepared.budgetUsd }));
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="start-eval-run-card">
      <p>
        Eval Run of {prepared.trials} trial(s)
        {prepared.estimatedUsd === null ? ' — no cost estimate' : ` — estimated $${prepared.estimatedUsd}`}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={primaryButtonClass} disabled={start.isPending || start.isSuccess} onClick={() => start.mutate(undefined)}>
          {start.isSuccess ? 'Started' : `Start — spend up to $${prepared.budgetUsd}`}
        </button>
        {start.error !== null && <span className="text-xs text-destructive">{start.error.message}</span>}
      </div>
    </div>
  );
}

function EvalRunRow({ evalRunId, onOpen, open }: { evalRunId: string; onOpen: () => void; open: boolean }) {
  const run = useEvalRun(open ? evalRunId : null);
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0">
      <button type="button" className="text-left text-xs font-mono hover:underline" onClick={onOpen}>{evalRunId.slice(0, 8)}</button>
      {open && (run.data === undefined ? <Loading /> : <div className="mt-2"><EvalRunReport output={run.data} /></div>)}
    </li>
  );
}

/** Prepare, confirm and read the Step's Eval Runs. */
export function EvalRunsSection({ step, data, mayEdit }: {
  step: EvaluatedStep;
  data: StepEvaluation['runs'];
  mayEdit: boolean;
}) {
  const [trials, setTrials] = React.useState(3);
  const [budget, setBudget] = React.useState('');
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const prepare = useStepEvaluationMutation(step, () => mediforce.evaluation.prepareRun({
    ...step,
    trialsPerCase: trials,
    ...(budget === '' ? {} : { budgetUsd: Number(budget) }),
  }));
  const runs = data.data?.evalRuns ?? [];
  // Prepared here, by the assistant or from the CLI: each waits for a person to confirm its budget.
  const waiting: PreparedEvalRun[] = runs.filter((run) => run.status === 'prepared').map((run) => ({
    evalRunId: run.id,
    budgetUsd: run.budgetUsd,
    estimatedUsd: run.estimate.totalUsd,
    trials: run.caseIds.length * run.trialsPerCase,
  }));

  return (
    <Section title="Eval Runs">
      {mayEdit && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Trials per case
            <input type="number" min={1} max={10} className={cn(inputClass, 'w-16')} value={trials} onChange={(event) => setTrials(Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-1">Budget $
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'w-24')} placeholder="auto" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <button
            type="button"
            className={buttonClass}
            disabled={prepare.isPending}
            onClick={() => prepare.mutate(undefined)}
          >Prepare</button>
          {prepare.error !== null && <span className="text-destructive">{prepare.error.message}</span>}
        </div>
      )}
      {waiting.map((run) => <StartEvalRunCard key={run.evalRunId} step={step} prepared={run} />)}
      {data.isLoading ? <Loading /> : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Eval Runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="text-sm">
              <span className="text-xs text-muted-foreground">{run.createdAt.slice(0, 16).replace('T', ' ')} · {run.status} · ${run.spentUsd.toFixed(2)} of ${run.budgetUsd}</span>
              <ul><EvalRunRow evalRunId={run.id} open={openRunId === run.id} onOpen={() => setOpenRunId(openRunId === run.id ? null : run.id)} /></ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
