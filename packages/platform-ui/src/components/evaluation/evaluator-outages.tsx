'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EvaluationSubject, EvaluatorOnError } from '@mediforce/platform-core';
import type { EvalRunOutput, EvaluatorView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useStepEvaluationMutation, useStepEvaluators } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';

type OutageLine = EvalRunOutput['report']['evaluators'][number];

const ON_ERROR_LABELS: Record<EvaluatorOnError, string> = { ignore: 'Ignore', escalate: 'Escalate' };

function trials(count: number): string {
  return `${count} trial${count === 1 ? '' : 's'}`;
}

/** Whether a check that cannot run on a live run holds it: only a production `schema` or `code` Evaluator can (ADR-0023 D13). */
export function mayEscalate(evaluator: EvaluatorView): boolean {
  return evaluator.runInProduction === true && (evaluator.latest.check.kind === 'schema' || evaluator.latest.check.kind === 'code');
}

/** What happens in production when this Evaluator's check cannot run there. */
function productionEffect(evaluator: EvaluatorView | undefined): string {
  if (evaluator === undefined) return 'It is no longer on the step.';
  if (evaluator.runInProduction === false) return 'Not run in production.';
  if (evaluator.latest.check.kind === 'llm_judge') return 'In production, a model judge only writes Scores; it never holds a run.';
  return evaluator.onError === 'escalate'
    ? 'In production, a run it cannot check is sent to a person.'
    : 'In production, a run it cannot check continues unchecked.';
}

/** The run's Evaluators that could not grade some trials, each with the Step's live Evaluator it is now. */
function useOutages(output: EvalRunOutput, step: EvaluationSubject): Array<{ line: OutageLine; live: EvaluatorView | undefined }> {
  const live = useStepEvaluators(step).data?.evaluators ?? [];
  return output.report.evaluators
    .filter((line) => line.errors > 0)
    .map((line) => ({ line, live: live.find((evaluator) => evaluator.id === line.evaluatorId) }));
}

/** Ignore lets a live run its check cannot grade continue; Escalate sends it to a person, as a failure would. */
export function OnErrorChoice({ step, evaluator, mayEdit, editReason }: {
  step: EvaluationSubject;
  evaluator: EvaluatorView;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const setOnError = useStepEvaluationMutation(step, (onError: EvaluatorOnError) =>
    mediforce.evaluation.setEvaluatorProduction({ evaluatorId: evaluator.id, onError }));
  const disabled = mayEdit === false || setOnError.isPending;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs" data-testid="evaluator-on-error">
      <span className="text-muted-foreground">When it cannot run:</span>
      <InstantTooltip label={mayEdit ? 'Ignore lets the run continue unchecked; Escalate sends it to a person.' : editReason ?? 'You cannot edit this workflow.'}>
        <span className="inline-flex divide-x rounded-md border">
          {(['ignore', 'escalate'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={evaluator.onError === value}
              disabled={disabled}
              onClick={() => setOnError.mutate(value)}
              className={cn(
                'px-2 py-0.5 first:rounded-l-md last:rounded-r-md disabled:opacity-50',
                evaluator.onError === value ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {ON_ERROR_LABELS[value]}
            </button>
          ))}
        </span>
      </InstantTooltip>
      {setOnError.error !== null && <span className="text-destructive">{setOnError.error.message}</span>}
    </span>
  );
}

/**
 * The Summary's warning that some Evaluators could not grade every trial —
 * the same outage that, in production, leaves a run unchecked unless the
 * Evaluator escalates.
 */
export function EvaluatorOutageAlert({ output, step, onOpenProblems }: {
  output: EvalRunOutput;
  step: EvaluationSubject;
  onOpenProblems: () => void;
}) {
  const outages = useOutages(output, step);
  if (outages.length === 0) return null;
  const hasDecision = outages.some(({ live }) => live !== undefined && mayEscalate(live));
  return (
    <section role="alert" className="space-y-1.5 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-xs" data-testid="evaluator-outage-alert">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-800 dark:text-red-200">
        <AlertTriangle className="h-4 w-4" />
        {outages.length === 1 ? 'An Evaluator' : `${outages.length} Evaluators`} could not grade every trial
      </h3>
      {outages.map(({ line, live }) => (
        <p key={line.evaluatorId}>
          <span className="font-medium">{line.name}</span> could not grade {trials(line.errors)}. {productionEffect(live)}
        </p>
      ))}
      {hasDecision && (
        <button type="button" className="font-medium text-red-800 underline hover:no-underline dark:text-red-200" onClick={onOpenProblems}>
          Decide in Problems
        </button>
      )}
    </section>
  );
}

/** The Problems tab's line per Evaluator that could not grade, with what a production run does when it cannot. */
export function EvaluatorOutageSummary({ output, step, mayEdit, editReason }: {
  output: EvalRunOutput;
  step: EvaluationSubject;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const outages = useOutages(output, step).filter(({ live }) => live !== undefined && mayEscalate(live));
  if (outages.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="evaluator-outages">
      <h3 className="text-sm font-semibold">Evaluators that could not grade</h3>
      <p className="text-xs text-muted-foreground">
        A check that cannot run in production lets the run continue unchecked, unless it is set to escalate — then the run goes to a person, as a failing check does.
      </p>
      <ul className="divide-y rounded-md border text-xs">
        {outages.map(({ line, live }) => (
          <li key={line.evaluatorId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p><span className="font-mono font-medium">{line.name}</span> could not grade {trials(line.errors)}.</p>
              <p className="text-muted-foreground">{productionEffect(live)}</p>
            </div>
            {live !== undefined && <OnErrorChoice step={step} evaluator={live} mayEdit={mayEdit} editReason={editReason} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
