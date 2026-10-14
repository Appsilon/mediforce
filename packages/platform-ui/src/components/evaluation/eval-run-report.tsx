'use client';

import * as React from 'react';
import {
  qualificationOutcome,
  qualificationSignatureMeaning,
  type AcceptanceCriterionVerdict,
  type QualificationDecision,
  type EvalRunReport,
  type EvaluatedStep,
  type JudgeVerdict,
} from '@mediforce/platform-core';
import type { EvalRunOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useStepEvaluationMutation, useStepQualification } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export const VERDICT_CLASSES: Record<AcceptanceCriterionVerdict['status'], string> = {
  met: 'bg-green-500/10 text-green-700 dark:text-green-400',
  missed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  not_evaluable: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

function TableTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

function describeFloor(verdict: AcceptanceCriterionVerdict): string {
  const passHatK = verdict.criterion.minPassHatK === undefined ? '' : ` and pass^k ≥ ${percent(verdict.criterion.minPassHatK)}`;
  return `pass rate ≥ ${percent(verdict.criterion.minPassRate)}${passHatK}`;
}

/** The Acceptance Criteria in one line: the verdict, and how many counted Evaluators reached the floor. Each Evaluator's own result is coloured in the Evaluators table. */
function CriteriaLine({ verdict }: { verdict: AcceptanceCriterionVerdict }) {
  const total = verdict.evaluators.length;
  const missed = verdict.evaluators.filter((evaluator) => evaluator.met === false).length;
  const detail = verdict.status === 'met'
    ? `${total === 1 ? 'the one counted Evaluator' : `all ${total} counted Evaluators`} at ${describeFloor(verdict)}`
    : verdict.status === 'missed'
      ? `${missed} of ${total} counted Evaluator${total === 1 ? '' : 's'} below ${describeFloor(verdict)}`
      : verdict.reason;
  return (
    <p className="text-sm" data-testid="criteria-verdict" data-status={verdict.status}>
      Acceptance criteria{' '}
      <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium', VERDICT_CLASSES[verdict.status])}>
        {verdict.status === 'not_evaluable' ? 'not judged' : verdict.status}
      </span>
      {' '}— {detail}
    </p>
  );
}

/** Every Evaluator's results; a counted one's pass rate is green when it reached the Acceptance Criteria, red when it missed them. */
function EvaluatorTable({ report }: { report: EvalRunReport }) {
  const judged = new Map((report.criteriaVerdict?.evaluators ?? []).map((line) => [line.evaluatorId, line.met]));
  return (
    <div>
    <TableTitle>Evaluators</TableTitle>
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr className="text-left">
          <th className="py-1 font-medium">Evaluator</th>
          <th className="py-1 font-medium">Pass rate</th>
          <th className="py-1 font-medium">95% CI</th>
          <th className="py-1 font-medium">pass@{report.k}</th>
          <th className="py-1 font-medium">pass^{report.k}</th>
          <th className="py-1 font-medium">Flaky</th>
          <th className="py-1 font-medium">Errors</th>
          <th className="py-1 font-medium">
            <InstantTooltip label="Model verdicts left out of the pass rate: a judge's below its minimum confidence and not accepted, or any denied by a person.">
              <span>Left out</span>
            </InstantTooltip>
          </th>
        </tr>
      </thead>
      <tbody>
        {report.evaluators.map((evaluator) => (
          <tr key={evaluator.evaluatorId} className={cn('border-t', evaluator.counted === false && 'text-muted-foreground')}>
            <td className="py-1.5">
              <span className="font-medium">{evaluator.name}</span>
              <span className="ml-1 text-xs text-muted-foreground">v{evaluator.version}</span>
              {evaluator.counted === false && <div className="text-xs">not counted — {evaluator.reason}</div>}
            </td>
            <td className="py-1.5">
              <span
                className={cn(judged.has(evaluator.evaluatorId) && 'rounded px-1.5 py-0.5 font-medium', judged.get(evaluator.evaluatorId) === true && VERDICT_CLASSES.met, judged.get(evaluator.evaluatorId) === false && VERDICT_CLASSES.missed)}
                data-testid="evaluator-pass-rate"
                data-met={judged.has(evaluator.evaluatorId) ? String(judged.get(evaluator.evaluatorId)) : undefined}
              >
                {percent(evaluator.passRate)}
              </span>
              {' '}<span className="text-xs text-muted-foreground">({evaluator.passes}/{evaluator.passes + evaluator.failures})</span>
            </td>
            <td className="py-1.5 text-xs">{evaluator.wilsonLower === null ? '—' : `${percent(evaluator.wilsonLower)}–${percent(evaluator.wilsonUpper)}`}</td>
            <td className="py-1.5">{percent(evaluator.passAtK)}</td>
            <td className="py-1.5">{percent(evaluator.passHatK)}</td>
            <td className="py-1.5">{percent(evaluator.flakiness)}</td>
            <td className="py-1.5">{evaluator.errors}</td>
            <td className="py-1.5">{evaluator.excluded}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/**
 * Whether the models grading this run can be trusted: how many of the
 * verdicts a person reviewed they denied.
 */
function VerdictReviewSection({ verdicts }: { verdicts: readonly JudgeVerdict[] }) {
  const accepted = verdicts.filter((verdict) => verdict.review?.decision === 'accepted').length;
  const denied = verdicts.filter((verdict) => verdict.review?.decision === 'denied').length;
  const reviewed = accepted + denied;
  return (
    <p className="text-xs" data-testid="verdict-review">
      <span className="font-medium">Model verdicts denied</span>{' '}
      {reviewed === 0 ? (
        <span className="text-muted-foreground">Waiting for model verdicts human validation</span>
      ) : (
        <>
          <span className="font-medium">{percent(denied / reviewed)}</span>
          <span className="text-muted-foreground"> — {denied} of {reviewed} reviewed model verdict(s) denied, {accepted} accepted. 0% means every review agreed with the model.</span>
        </>
      )}
    </p>
  );
}

/** The verdict the Acceptance Criteria gave: only a run that met them passed. */
function computedOutcome(verdict: AcceptanceCriterionVerdict): 'passed' | 'failed' {
  return verdict.status === 'met' ? 'passed' : 'failed';
}

/**
 * A person's signed decision on a run's verdict (ADR-0023 D10): confirm it,
 * or overwrite it with a written justification. They read what the signature
 * means.
 */
function SignQualificationForm({ step, evalRunId, verdict, decision, onDone }: {
  step: EvaluatedStep;
  evalRunId: string;
  verdict: AcceptanceCriterionVerdict;
  decision: QualificationDecision;
  onDone: () => void;
}) {
  const [justification, setJustification] = React.useState('');
  const computed = computedOutcome(verdict);
  const outcome = decision === 'confirmed' ? computed : computed === 'passed' ? 'failed' : 'passed';
  const sign = useStepEvaluationMutation(step, () => mediforce.evaluation.signQualification({
    evalRunId,
    decision,
    ...(decision === 'overwritten' ? { justification: justification.trim() } : {}),
  }));
  const justified = decision === 'confirmed' || justification.trim() !== '';
  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs" data-testid="sign-qualification-form">
      <p className="font-medium">
        {decision === 'confirmed' ? `Confirm that the evaluation ${computed}` : `Overwrite the evaluation verdict: ${computed} → ${outcome}`} (e-signature)
      </p>
      <p>{qualificationSignatureMeaning(decision, outcome)}</p>
      {decision === 'overwritten' && (
        <label className="block space-y-1">
          <span>The criteria gave {computed} ({verdict.reason}). Why is {outcome} the right verdict?</span>
          <textarea
            aria-label="Justification for overwriting the verdict"
            className={cn(inputClass, 'w-full min-h-16 text-xs')}
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
          />
        </label>
      )}
      {sign.error !== null && <p className="text-destructive">{sign.error.message}</p>}
      <div className="flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={justified === false || sign.isPending} onClick={() => sign.mutate(undefined, { onSuccess: onDone })}>
          Sign
        </button>
        <button type="button" className={buttonClass} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/** Why this run cannot be signed for, or null when it can. */
function signingBlocked(output: EvalRunOutput, mayEdit: boolean, editReason: string | undefined): string | null {
  const { evalRun, report } = output;
  if (mayEdit === false) return editReason ?? 'You may not edit this workflow';
  if (evalRun.status === 'cancelled') return 'This run was cancelled; sign on a run that finished';
  if (evalRun.status === 'prepared' || evalRun.status === 'running' || report.trials.inProgress > 0) return 'Sign once every trial is scored';
  if (evalRun.acceptanceCriteria === null) return 'No Acceptance Criteria were frozen into this run';
  if (evalRun.fingerprint === null) return 'This run was prepared before Step Fingerprints';
  return null;
}

const DECISION_EXPLANATION = 'A person signs off every Eval Run. The step\'s validation stays "Waiting for human approval" until you confirm the verdict the Acceptance Criteria gave, or overwrite it with a justification.';

/**
 * An Eval Run's results (ADR-0023 D10): every Evaluator's pass rate with its
 * Wilson 95% interval, pass@k, pass^k and flakiness, the verdict on the
 * Acceptance Criteria, and how well the grading models' confidence matches a
 * person's review of their verdicts. A person confirms or overwrites the verdict from here.
 */
export function EvalRunSummary({ output, step, mayEdit, editReason }: {
  output: EvalRunOutput;
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const { evalRun, report } = output;
  const [signing, setSigning] = React.useState<QualificationDecision | null>(null);
  const blocked = signingBlocked(output, mayEdit, editReason);
  const qualification = useStepQualification(step, evalRun.definitionVersion);
  const signed = qualification.data?.history.find((candidate) => candidate.evalRunId === evalRun.id);
  const verdict = report.criteriaVerdict;
  return (
    <div className="space-y-5" data-testid="eval-run-report">
      {evalRun.acceptanceCriteria === null && (
        <p className="text-xs text-muted-foreground">No Acceptance Criteria were frozen into this run, so nothing is judged.</p>
      )}
      {verdict !== null && <CriteriaLine verdict={verdict} />}
      <EvaluatorTable report={report} />
      <VerdictReviewSection verdicts={report.judgeVerdicts} />
      {signed !== undefined ? (
        <p className="text-sm" data-testid="run-decision" data-outcome={qualificationOutcome(signed)}>
          Verdict {signed.decision === 'confirmed' ? 'confirmed' : 'overwritten'} by <span className="font-medium">{signed.signature.signerName}</span>:
          {' '}evaluation <span className="font-medium">{qualificationOutcome(signed)}</span>.
          {signed.deviations.map((deviation, index) => <span key={index} className="block text-xs text-muted-foreground">Reason: {deviation.justification}</span>)}
        </p>
      ) : verdict !== null && signing !== null ? (
        <SignQualificationForm step={step} evalRunId={evalRun.id} verdict={verdict} decision={signing} onDone={() => setSigning(null)} />
      ) : verdict !== null && (
        <div className="flex flex-wrap items-start gap-2">
          <InstantTooltip label={blocked ?? DECISION_EXPLANATION}>
            <span className="inline-flex">
              <button type="button" className={primaryButtonClass} disabled={blocked !== null} onClick={() => setSigning('confirmed')} data-testid="confirm-verdict">
                Confirm that evaluation {computedOutcome(verdict)}
              </button>
            </span>
          </InstantTooltip>
          <InstantTooltip label={blocked ?? DECISION_EXPLANATION}>
            <span className="inline-flex">
              <button type="button" className={buttonClass} disabled={blocked !== null} onClick={() => setSigning('overwritten')} data-testid="overwrite-verdict">
                Overwrite the evaluation verdict
              </button>
            </span>
          </InstantTooltip>
        </div>
      )}
    </div>
  );
}
