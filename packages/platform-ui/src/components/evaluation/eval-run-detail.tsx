'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  evalRunAcceptance,
  type EvalRunEvaluator,
  type EvalTrial,
  type EvalTrialResult,
  type EvaluatedStep,
  type EvaluatorVersion,
} from '@mediforce/platform-core';
import type { EvalRunOutput } from '@mediforce/platform-api/contract';
import { formatCostUsd, formatDuration } from '@/lib/format';
import { mediforce } from '@/lib/mediforce';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useEvalRun, useEvalRunMutation, useStepDatasets, useStepEvaluatorHistory } from '@/hooks/use-step-evaluation';
import { useWorkflowEditGate, useWorkflowRunGate } from '@/hooks/use-workflow-access';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { AcceptanceBadge, EvalRunStatusBadge, OutcomeChip, TrialResultBadge, TrialStatusBadge } from './eval-run-badges';
import { EvalRunSummary, percent } from './eval-run-report';
import { JudgeVerdicts } from './judge-verdicts';
import { CHECK_KINDS, CheckDetails } from './evaluator-check-editor';
import { StartEvalRunCard } from './step-evaluation-sections';
import { buttonClass } from './evaluation-styles';

const RUN_TABS = ['summary', 'trials', 'evaluators', 'verdicts', 'problems'] as const;
type RunTab = (typeof RUN_TABS)[number];

function isRunTab(value: string | null): value is RunTab {
  return RUN_TABS.some((tab) => tab === value);
}

function dateTime(value: string | null): string {
  return value === null ? '—' : format(new Date(value), 'yyyy-MM-dd HH:mm');
}

/** Everything the run's tabs link with: its step, and where one of its trials is shown. */
interface RunContext {
  output: EvalRunOutput;
  step: EvaluatedStep;
  trialHref: (trialId: string) => string;
  /** By variant id; empty when the run has one variant, so no label is shown. */
  variantLabels: ReadonlyMap<string, string>;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function TrialLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs text-primary hover:underline">
      Details <ChevronRight className="h-3 w-3" />
    </Link>
  );
}

function trialLabel(result: EvalTrialResult, trial: EvalTrial): string {
  return `${result.caseName ?? trial.caseId.slice(0, 8)} · trial ${trial.trialIndex + 1}`;
}

type TrialFilter = 'all' | 'failed' | 'problems';

/** Why a trial had a problem — it failed, or a check could not grade it — or null when it had none. */
function problemOf(trial: EvalTrial, result: EvalTrialResult | undefined, evaluators: readonly EvalRunEvaluator[]): string | null {
  if (trial.error !== null) return trial.error;
  const errored = (result?.evaluators ?? [])
    .filter((entry) => entry.outcome === 'errored')
    .map((entry) => evaluators.find((evaluator) => evaluator.evaluatorId === entry.evaluatorId)?.name ?? entry.evaluatorId);
  if (errored.length > 0) return `Could not be graded by ${errored.join(', ')}.`;
  return trial.status === 'failed' ? 'Failed without a recorded reason.' : null;
}

function trialProblems(output: EvalRunOutput): Array<{ trial: EvalTrial; result: EvalTrialResult | undefined; problem: string }> {
  const results = new Map(output.report.trialResults.map((result) => [result.trialId, result]));
  return output.trials.flatMap((trial) => {
    const result = results.get(trial.id);
    const problem = problemOf(trial, result, output.evalRun.evaluators);
    return problem === null ? [] : [{ trial, result, problem }];
  });
}

/** Every trial: its case, how each Evaluator graded it, what it cost; a row opens everything it read and gave. */
function TrialsTab({ output, trialHref, variantLabels }: RunContext) {
  const [filter, setFilter] = React.useState<TrialFilter>('all');
  const trials = new Map(output.trials.map((trial) => [trial.id, trial]));
  const rows = output.report.trialResults
    .map((result) => ({ result, trial: trials.get(result.trialId) }))
    .filter((row): row is { result: EvalTrialResult; trial: EvalTrial } => row.trial !== undefined)
    .filter(({ result, trial }) => filter === 'all'
      || (filter === 'failed' && (result.passed === false || trial.status === 'failed'))
      || (filter === 'problems' && problemOf(trial, result, output.evalRun.evaluators) !== null));
  const evaluators = output.evalRun.evaluators;
  return (
    <div className="space-y-3">
      <div className="inline-flex divide-x rounded-md border text-xs">
        {(['all', 'failed', 'problems'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn('px-2.5 py-1 first:rounded-l-md last:rounded-r-md', filter === value ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            {value === 'all' ? 'All' : value === 'failed' ? 'Failed' : 'With problems'}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No trials match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="eval-trials-table">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Case</th>
                {variantLabels.size > 0 && <th className="px-3 py-2 font-medium">Variant</th>}
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">
                  <InstantTooltip label="Passed every counted Evaluator that grades its case.">
                    <span>Result</span>
                  </InstantTooltip>
                </th>
                {evaluators.map((evaluator) => (
                  <th key={evaluator.evaluatorId} className="px-3 py-2 font-medium">
                    <InstantTooltip label={`${evaluator.severity} · ${CHECK_KINDS[evaluator.kind].label}${evaluator.counted ? '' : ' · not counted'}`}>
                      <span className="font-mono">{evaluator.name}</span>
                    </InstantTooltip>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">
                  <InstantTooltip label="How sure the agent said it was of its output.">
                    <span>Agent confidence</span>
                  </InstantTooltip>
                </th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ result, trial }) => (
                <tr key={trial.id} className="border-b last:border-0 hover:bg-muted/30" data-testid="eval-trial-row">
                  <td className="px-3 py-2 text-xs">{trialLabel(result, trial)}</td>
                  {variantLabels.size > 0 && <td className="px-3 py-2 text-xs">{variantLabels.get(trial.variantId) ?? trial.variantId}</td>}
                  <td className="px-3 py-2"><TrialStatusBadge status={trial.status} /></td>
                  <td className="px-3 py-2"><TrialResultBadge passed={result.passed} /></td>
                  {evaluators.map((evaluator) => {
                    const entry = result.evaluators.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
                    return (
                      <td key={evaluator.evaluatorId} className="px-3 py-2">
                        {entry === undefined ? <span className="text-xs text-muted-foreground">—</span> : <OutcomeChip outcome={entry.outcome} detail={entry.comment} />}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-xs tabular-nums">{percent(trial.confidence)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{trial.costUsd === null ? '—' : formatCostUsd(trial.costUsd)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{trial.durationMs === null ? '—' : formatDuration(trial.durationMs)}</td>
                  <td className="px-3 py-2 text-right"><TrialLink href={trialHref(trial.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One Evaluator over the whole run: what it looks for, how it did per variant, and its grade on every trial. */
function EvaluatorCard({ evaluator, version, context }: {
  evaluator: EvalRunEvaluator;
  version: EvaluatorVersion | undefined;
  context: RunContext;
}) {
  const { output, trialHref, variantLabels } = context;
  const trials = new Map(output.trials.map((trial) => [trial.id, trial]));
  const graded = output.report.trialResults.flatMap((result) => {
    const entry = result.evaluators.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
    const trial = trials.get(result.trialId);
    return entry === undefined || trial === undefined ? [] : [{ result, entry, trial }];
  });
  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="eval-run-evaluator">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-medium">{evaluator.name}</span>
        <span className="text-xs text-muted-foreground">v{evaluator.version} · {evaluator.severity} · {CHECK_KINDS[evaluator.kind].label}</span>
        {evaluator.counted === false && <span className="text-xs text-amber-700 dark:text-amber-300">not counted — {evaluator.reason}</span>}
      </div>
      {version !== undefined && (
        <div className="space-y-2">
          <p className="text-sm"><span className="text-muted-foreground">Looks for: </span>{version.rule}</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">How it checks</summary>
            <div className="mt-2"><CheckDetails check={version.check} /></div>
          </details>
        </div>
      )}
      <ul className="space-y-0.5 text-xs">
        {output.report.variants.map((variant) => {
          const stats = variant.evaluators.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
          if (stats === undefined) return null;
          return (
            <li key={variant.id}>
              {variantLabels.size > 0 && <span className="font-medium">{variant.label}: </span>}
              pass rate {percent(stats.passRate)} ({stats.passes}/{stats.passes + stats.failures})
              {stats.wilsonLower !== null && ` · 95% CI ${percent(stats.wilsonLower)}–${percent(stats.wilsonUpper)}`}
              {` · pass@${output.report.k} ${percent(stats.passAtK)} · pass^${output.report.k} ${percent(stats.passHatK)}`}
              {stats.errors > 0 && ` · ${stats.errors} could not grade`}
              {stats.excluded > 0 && ` · ${stats.excluded} left out`}
            </li>
          );
        })}
      </ul>
      {graded.length > 0 && (
        <ul className="divide-y rounded-md border text-xs">
          {graded.map(({ result, entry, trial }) => (
            <li key={trial.id} className="flex items-start gap-3 px-3 py-2">
              <OutcomeChip outcome={entry.outcome} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {trialLabel(result, trial)}
                  {variantLabels.size > 0 && <span className="font-normal text-muted-foreground"> · {variantLabels.get(trial.variantId)}</span>}
                </p>
                {entry.comment !== null && <p className="line-clamp-2 text-muted-foreground" title={entry.comment}>{entry.comment}</p>}
              </div>
              <TrialLink href={trialHref(trial.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvaluatorsTab(context: RunContext) {
  const history = useStepEvaluatorHistory(context.step);
  const versionOf = (evaluator: EvalRunEvaluator) => history.data?.evaluators
    .find((candidate) => candidate.id === evaluator.evaluatorId)?.versions
    .find((candidate) => candidate.version === evaluator.version);
  return (
    <div className="space-y-3">
      {context.output.evalRun.evaluators.map((evaluator) => (
        <EvaluatorCard key={evaluator.evaluatorId} evaluator={evaluator} version={versionOf(evaluator)} context={context} />
      ))}
    </div>
  );
}

/** Trials that failed, or that a check could not grade, with why. */
function ProblemsTab({ output, trialHref, variantLabels }: RunContext) {
  const problems = trialProblems(output);
  const { unrecordedCalls } = output.report.mcp;
  if (problems.length === 0 && unrecordedCalls.length === 0) return <p className="text-sm text-muted-foreground">No trial had a problem.</p>;
  return (
    <div className="space-y-3">
      {unrecordedCalls.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Replayed MCP calls no recording answered: {unrecordedCalls.map((call) => `${call.server}.${call.tool} ×${call.count}`).join(', ')}.
        </p>
      )}
      {problems.length > 0 && (
        <ul className="divide-y rounded-md border text-xs" data-testid="eval-run-problems">
          {problems.map(({ trial, result, problem }) => {
            return (
              <li key={trial.id} className="flex items-start gap-3 px-3 py-2">
                <TrialStatusBadge status={trial.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {result === undefined ? `trial ${trial.trialIndex + 1}` : trialLabel(result, trial)}
                    {variantLabels.size > 0 && <span className="font-normal text-muted-foreground"> · {variantLabels.get(trial.variantId)}</span>}
                  </p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{problem}</p>
                </div>
                <TrialLink href={trialHref(trial.id)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RunHeader({ handle, workflowName, output, step, mayRun, runReason }: {
  handle: string;
  workflowName: string;
  output: EvalRunOutput;
  step: EvaluatedStep;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const { evalRun, report } = output;
  const datasets = useStepDatasets(step);
  const dataset = datasets.data?.datasets.find((candidate) => candidate.id === evalRun.datasetVersionId);
  const cancel = useEvalRunMutation(step, evalRun.id, () => mediforce.evaluation.cancelRun({ evalRunId: evalRun.id }));
  const active = evalRun.status === 'running' || evalRun.status === 'prepared';
  return (
    <div className="space-y-4">
      <Link
        href={routes.workflowEvaluation(handle, workflowName, { version: evalRun.definitionVersion, step: evalRun.stepId })}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Evaluation · {evalRun.stepId}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Eval Run <span className="font-mono">{evalRun.id.slice(0, 8)}</span></h1>
        <EvalRunStatusBadge status={evalRun.status} />
        <AcceptanceBadge acceptance={evalRunAcceptance(evalRun, report)} />
        {active && mayRun && (
          <button type="button" className={cn(buttonClass, 'ml-auto')} disabled={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
            Cancel run
          </button>
        )}
      </div>
      {cancel.error !== null && <p className="text-xs text-destructive">{cancel.error.message}</p>}
      {evalRun.status === 'prepared' && (
        <StartEvalRunCard
          step={step}
          prepared={{
            evalRunId: evalRun.id,
            budgetUsd: evalRun.budgetUsd,
            estimatedUsd: evalRun.estimate.totalUsd,
            trials: evalRun.caseIds.length * evalRun.trialsPerCase * evalRun.variants.length,
          }}
          mayRun={mayRun}
          runReason={runReason}
        />
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Meta label="Step">{evalRun.stepId} · v{evalRun.definitionVersion}</Meta>
        <Meta label="Dataset">{dataset === undefined ? '—' : `v${dataset.version}`} · {evalRun.caseIds.length} case(s)</Meta>
        <Meta label="Trials">
          {report.trials.scored}/{report.trials.total} scored
          {report.trials.inProgress > 0 && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
          <span className="block text-xs text-muted-foreground">
            {evalRun.trialsPerCase} per case × {evalRun.variants.length} variant(s)
            {report.trials.failed > 0 && ` · ${report.trials.failed} failed`}
            {report.trials.skipped > 0 && ` · ${report.trials.skipped} skipped`}
          </span>
        </Meta>
        <Meta label="Cost">
          {formatCostUsd(report.costUsd)} <span className="text-xs text-muted-foreground">of ${evalRun.budgetUsd}</span>
          <span className="block text-xs text-muted-foreground">{report.inputTokens + report.outputTokens} tokens</span>
        </Meta>
        <Meta label="Created">{dateTime(evalRun.createdAt)}<span className="block text-xs text-muted-foreground">by {evalRun.createdBy}</span></Meta>
        <Meta label="Finished">{dateTime(evalRun.completedAt)}</Meta>
      </dl>
    </div>
  );
}

const tabTriggerClass = 'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground';

/**
 * One Eval Run (ADR-0023): its header — status, how its champion fared on the
 * Acceptance Criteria, dataset, cost — and five views from overall to one
 * trial: the summary per variant, every trial, every Evaluator, every model
 * verdict to review, and the trials that had problems. Each trial opens on its
 * own page with everything the step and its Evaluators read and gave.
 */
export function EvalRunDetail({ handle, workflowName, evalRunId }: { handle: string; workflowName: string; evalRunId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const run = useEvalRun(evalRunId);
  const { mayEdit, reason: editReason } = useWorkflowEditGate(handle, workflowName);
  const { mayRun, reason: runReason } = useWorkflowRunGate(handle, workflowName);
  const requested = searchParams.get('tab');
  const tab: RunTab = isRunTab(requested) ? requested : 'summary';

  if (run.error instanceof Error) return <p className="p-6 text-sm text-destructive">{run.error.message}</p>;
  if (run.data === undefined) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const output = run.data;
  const { evalRun, report } = output;
  const step: EvaluatedStep = { namespace: evalRun.namespace, workflowName: evalRun.workflowName, stepId: evalRun.stepId };
  const context: RunContext = {
    output,
    step,
    trialHref: (trialId) => routes.workflowEvalTrial(handle, workflowName, evalRun.id, trialId),
    variantLabels: new Map(evalRun.variants.length > 1 ? evalRun.variants.map((variant) => [variant.id, variant.label]) : []),
  };
  const leftOut = report.judgeVerdicts.filter((verdict) => verdict.counts === false).length;
  const problems = trialProblems(output).length;
  const labels: Record<RunTab, string> = {
    summary: 'Summary',
    trials: `Trials (${report.trials.total})`,
    evaluators: `Evaluators (${evalRun.evaluators.length})`,
    verdicts: `Model verdicts (${report.judgeVerdicts.length}${leftOut > 0 ? `, ${leftOut} left out` : ''})`,
    problems: `Problems (${problems})`,
  };
  const select = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return (
    <div className="space-y-6 p-6" data-testid="eval-run-detail">
      <RunHeader handle={handle} workflowName={workflowName} output={output} step={step} mayRun={mayRun} runReason={runReason} />
      <Tabs.Root value={tab} onValueChange={select}>
        <Tabs.List className="flex flex-wrap gap-0 border-b">
          {RUN_TABS.map((value) => (
            <Tabs.Trigger key={value} value={value} className={tabTriggerClass} data-testid={`eval-run-tab-${value}`}>{labels[value]}</Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="summary" className="pt-4">
          <EvalRunSummary output={output} step={step} mayEdit={mayEdit} editReason={editReason} />
        </Tabs.Content>
        <Tabs.Content value="trials" className="pt-4"><TrialsTab {...context} /></Tabs.Content>
        <Tabs.Content value="evaluators" className="pt-4"><EvaluatorsTab {...context} /></Tabs.Content>
        <Tabs.Content value="verdicts" className="pt-4">
          {report.judgeVerdicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No model judged a trial of this run.</p>
          ) : (
            <JudgeVerdicts
              step={step}
              evalRunId={evalRun.id}
              verdicts={report.judgeVerdicts}
              mayEdit={mayEdit}
              editReason={editReason}
              variantLabels={context.variantLabels}
              trialHref={context.trialHref}
            />
          )}
        </Tabs.Content>
        <Tabs.Content value="problems" className="pt-4"><ProblemsTab {...context} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
