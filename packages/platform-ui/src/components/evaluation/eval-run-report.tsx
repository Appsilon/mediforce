'use client';

import * as React from 'react';
import {
  describeAcceptanceCriteria,
  describeMcpReport,
  qualificationSignatureMeaning,
  type AcceptanceCriterionVerdict,
  type EvalRunVariantReport,
  type EvaluatedStep,
  type StepVariantPatch,
  type VariantComparison,
} from '@mediforce/platform-core';
import type { EvalRunOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { useAuth } from '@/contexts/auth-context';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { ControlModeBadge } from '@/components/ui/control-mode-badge';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** What a variant changes about the step, in words. */
export function describePatch(patch: StepVariantPatch): string {
  const changes = [
    patch.model !== undefined && `model ${patch.model}`,
    patch.prompt !== undefined && 'its own prompt',
    patch.skillCommit !== undefined && `skills at ${patch.skillCommit.slice(0, 8)}`,
    patch.allowedTools !== undefined && `tools ${patch.allowedTools.length === 0 ? 'none extra' : patch.allowedTools.join(', ')}`,
    patch.mcpRestrictions !== undefined && `MCP narrowed: ${Object.keys(patch.mcpRestrictions).join(', ')}`,
    patch.examples !== undefined && (patch.examples.length === 0 ? 'no examples' : `${patch.examples.length} example(s)`),
  ].filter((change) => change !== false);
  return changes.length === 0 ? 'the step as it is' : changes.join('; ');
}

const VERDICT_CLASSES: Record<AcceptanceCriterionVerdict['status'], string> = {
  met: 'bg-green-500/10 text-green-700 dark:text-green-400',
  missed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  not_evaluable: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

function CriteriaVerdicts({ verdicts }: { verdicts: readonly AcceptanceCriterionVerdict[] }) {
  return (
    <ul className="space-y-0.5 text-xs" data-testid="criteria-verdicts">
      {verdicts.map((verdict) => (
        <li key={verdict.severity}>
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', VERDICT_CLASSES[verdict.status])}>
            {verdict.severity} {verdict.status === 'not_evaluable' ? 'not judged' : verdict.status}
          </span>
          <span className="ml-1.5 text-muted-foreground">{verdict.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function EvaluatorTable({ variant, k }: { variant: EvalRunVariantReport; k: number }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr className="text-left">
          <th className="py-1 font-medium">Evaluator</th>
          <th className="py-1 font-medium">Pass rate</th>
          <th className="py-1 font-medium">95% CI</th>
          <th className="py-1 font-medium">pass@{k}</th>
          <th className="py-1 font-medium">pass^{k}</th>
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
        {variant.evaluators.map((evaluator) => (
          <tr key={evaluator.evaluatorId} className={cn('border-t', evaluator.counted === false && 'text-muted-foreground')}>
            <td className="py-1.5">
              <span className="font-medium">{evaluator.name}</span>
              <span className="ml-1 text-xs text-muted-foreground">v{evaluator.version} · {evaluator.severity}</span>
              {evaluator.counted === false && <div className="text-xs">not counted — {evaluator.reason}</div>}
            </td>
            <td className="py-1.5">{percent(evaluator.passRate)} <span className="text-xs text-muted-foreground">({evaluator.passes}/{evaluator.passes + evaluator.failures})</span></td>
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
  );
}

/**
 * Whether the agent's own confidence can be trusted, and what that allows:
 * the agent reports a confidence with every output; bin by bin, how often an
 * output it was that sure of actually passed every counted Evaluator. When the
 * two agree, outputs above a threshold can skip a person (Control Mode L4).
 */
function ConfidenceSection({ variant }: { variant: EvalRunVariantReport }) {
  const { confidence, recommendation } = variant;
  return (
    <div className="space-y-2 text-xs" data-testid="confidence-calibration">
      <p className="font-medium text-sm">Can the agent&apos;s confidence be trusted?</p>
      <p className="text-muted-foreground">
        The agent reports how sure it is of each output (0–1). This checks that claim against the results: of the outputs where it said, say, 90%, did about 90% pass every counted Evaluator?
        If so, its confidence can decide which outputs need a person.
      </p>
      {confidence === null ? (
        <p className="text-muted-foreground">The agent reported no confidence on any graded trial, so there is nothing to compare.</p>
      ) : (
        <>
          <p>
            <InstantTooltip label="Expected calibration error: the average gap between the confidence the agent stated and the share of those outputs that passed, weighted by how many trials each bin holds. 0 means its confidence matches its results exactly; 0.2 means it is off by 20 points on average.">
              <span className="font-medium underline decoration-dotted">Calibration error {confidence.ece.toFixed(3)}</span>
            </InstantTooltip>
            <span className="text-muted-foreground"> over {confidence.count} graded trial(s) — 0 is a perfect match.</span>
          </p>
          <table className="text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="pr-4 font-medium">Agent said</th>
                <th className="pr-4 font-medium">Trials</th>
                <th className="pr-4 font-medium">Average stated</th>
                <th className="font-medium">Actually passed</th>
              </tr>
            </thead>
            <tbody>
              {confidence.bins.map((bin) => (
                <tr key={bin.lower}>
                  <td className="pr-4">{percent(bin.lower)}–{percent(bin.upper)}</td>
                  <td className="pr-4">{bin.count}</td>
                  <td className="pr-4">{percent(bin.meanConfidence)}</td>
                  <td className={cn(Math.abs(bin.meanConfidence - bin.passRate) > 0.2 && 'font-medium text-amber-700 dark:text-amber-300')}>{percent(bin.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {recommendation !== null && (
        <p data-testid="control-recommendation">
          <span className="font-medium">
            Recommended routing: <ControlModeBadge executor="agent" autonomyLevel={recommendation.autonomyLevel} showNumber />
            {recommendation.confidenceThreshold !== null && ` above confidence ${recommendation.confidenceThreshold}`}
          </span>
          {recommendation.coverage !== null && <span className="text-muted-foreground"> ({percent(recommendation.coverage)} of outputs would skip a person)</span>}
          <span className="text-muted-foreground"> — {recommendation.reason}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Signing a Step Qualification for one variant (ADR-0023 D10): the person
 * reads what the signature means, justifies every criterion the variant did
 * not meet, and re-enters their password where password sign-in is enabled.
 */
function SignQualificationForm({ step, evalRunId, variant, onDone }: {
  step: EvaluatedStep;
  evalRunId: string;
  variant: EvalRunVariantReport;
  onDone: () => void;
}) {
  const unmet = variant.criteria.filter((verdict) => verdict.status !== 'met');
  const [justifications, setJustifications] = React.useState<Record<string, string>>({});
  const [password, setPassword] = React.useState('');
  // Without password sign-in, signing re-authenticates by the session; the server ignores a password.
  const { passwordAuthEnabled } = useAuth();
  const sign = useStepEvaluationMutation(step, () => mediforce.evaluation.signQualification({
    evalRunId,
    variantId: variant.id,
    deviations: unmet.map((verdict) => ({ severity: verdict.severity, justification: (justifications[verdict.severity] ?? '').trim() })),
    ...(password === '' ? {} : { password }),
  }));
  const justified = unmet.every((verdict) => (justifications[verdict.severity] ?? '').trim() !== '');
  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs" data-testid="sign-qualification-form">
      <p className="font-medium">Sign a Step Qualification for {variant.label}</p>
      <p>{qualificationSignatureMeaning()}</p>
      {unmet.map((verdict) => (
        <label key={verdict.severity} className="block space-y-1">
          <span>
            The {verdict.severity} criterion was {verdict.status === 'missed' ? 'missed' : 'not judged'} ({verdict.reason}). Signing records a deviation — why is that acceptable?
          </span>
          <textarea
            aria-label={`Justification for the ${verdict.severity} criterion`}
            className={cn(inputClass, 'w-full min-h-16 text-xs')}
            value={justifications[verdict.severity] ?? ''}
            onChange={(event) => setJustifications({ ...justifications, [verdict.severity]: event.target.value })}
          />
        </label>
      ))}
      {passwordAuthEnabled !== false && (
        <label className="flex items-center gap-2">
          <span>Your password</span>
          <input type="password" autoComplete="current-password" className={cn(inputClass, 'text-xs')} value={password} onChange={(event) => setPassword(event.target.value)} />
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

/** Why a variant of this run cannot be signed for, or null when it can. */
function signingBlocked(output: EvalRunOutput, variant: EvalRunVariantReport, mayEdit: boolean, editReason: string | undefined): string | null {
  const { evalRun, report } = output;
  if (mayEdit === false) return editReason ?? 'You may not edit this workflow';
  if (evalRun.status === 'cancelled') return 'This run was cancelled; sign on a run that finished';
  if (evalRun.status === 'prepared' || evalRun.status === 'running' || report.trials.inProgress > 0) return 'Sign once every trial is scored';
  if (evalRun.acceptanceCriteria === null) return 'No Acceptance Criteria were frozen into this run';
  if (variant.fingerprint === null) return 'This run was prepared before Step Fingerprints';
  return null;
}

function VariantReport({ output, variant, step, mayEdit, editReason }: {
  output: EvalRunOutput;
  variant: EvalRunVariantReport;
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const [signing, setSigning] = React.useState(false);
  const blocked = signingBlocked(output, variant, mayEdit, editReason);
  const comparison = output.report.comparison.find((candidate) => candidate.variantId === variant.id);
  return (
    <div className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0" data-testid="variant-report">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium">{variant.label}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">{describePatch(variant.patch)}</span>
          {variant.fingerprint !== null && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{variant.fingerprint.hash.slice(0, 12)}</span>}
        </div>
        <span className="text-xs text-muted-foreground">
          {variant.trials.scored}/{variant.trials.total} scored · ${variant.costUsd.toFixed(4)}
          {variant.meanDurationMs !== null && ` · mean ${(variant.meanDurationMs / 1000).toFixed(1)}s`}
        </span>
      </div>
      <EvaluatorTable variant={variant} k={output.report.k} />
      {variant.criteria.length > 0 && <CriteriaVerdicts verdicts={variant.criteria} />}
      {comparison !== undefined && <ComparisonTable comparison={comparison} />}
      <ConfidenceSection variant={variant} />
      {signing ? (
        <SignQualificationForm
          step={step}
          evalRunId={output.evalRun.id}
          variant={variant}
          onDone={() => setSigning(false)}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <InstantTooltip label={blocked ?? undefined}>
            <span className="inline-flex">
              <button type="button" className={buttonClass} disabled={blocked !== null} onClick={() => setSigning(true)} data-testid="sign-qualification">
                Sign Step Qualification
              </button>
            </span>
          </InstantTooltip>
        </div>
      )}
    </div>
  );
}

/** A challenger against the champion: a difference counts only when the two 95% intervals do not overlap. */
function ComparisonTable({ comparison }: { comparison: VariantComparison }) {
  return (
    <div className="space-y-1 text-xs" data-testid="variant-comparison">
      <p className="text-muted-foreground">
        Against the step as it is
        {comparison.meanCostDeltaUsd !== null && ` · mean cost ${comparison.meanCostDeltaUsd >= 0 ? '+' : ''}$${comparison.meanCostDeltaUsd.toFixed(4)}`}
        {comparison.meanDurationDeltaMs !== null && ` · mean time ${comparison.meanDurationDeltaMs >= 0 ? '+' : ''}${(comparison.meanDurationDeltaMs / 1000).toFixed(1)}s`}
      </p>
      <table>
        <tbody>
          {comparison.evaluators.map((evaluator) => (
            <tr key={evaluator.evaluatorId}>
              <td className="pr-4">{evaluator.name}</td>
              <td className="pr-4">{percent(evaluator.championPassRate)} → {percent(evaluator.challengerPassRate)}</td>
              <td className={cn(
                evaluator.verdict === 'better' && 'text-green-700 dark:text-green-400',
                evaluator.verdict === 'worse' && 'text-red-700 dark:text-red-400',
                evaluator.verdict === 'no_clear_difference' && 'text-muted-foreground',
              )}>{evaluator.verdict.replace(/_/g, ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An Eval Run's results (ADR-0023 D5, D10): per variant, every Evaluator's
 * pass rate with its Wilson 95% interval, pass@k, pass^k and flakiness, the
 * verdict on each Acceptance Criterion, a challenger against the champion,
 * whether the agent's confidence can be trusted and the routing it allows. A
 * person signs a Step Qualification for a variant from here.
 */
export function EvalRunSummary({ output, step, mayEdit, editReason }: {
  output: EvalRunOutput;
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const { evalRun, report } = output;
  return (
    <div className="space-y-4" data-testid="eval-run-report">
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          {evalRun.acceptanceCriteria === null
            ? 'No Acceptance Criteria were frozen into this run, so nothing is judged.'
            : `Judged against ${describeAcceptanceCriteria(evalRun.acceptanceCriteria)}.`}
        </p>
        {evalRun.exampleCaseIds.length > 0 && (
          <p data-testid="example-cases-left-out">
            {evalRun.exampleCaseIds.length} case(s) left out — a variant&apos;s few-shot examples came from them.
          </p>
        )}
        <p data-testid="eval-run-mcp">{describeMcpReport(report.mcp)}</p>
      </div>
      {report.variants.map((variant) => (
        <VariantReport key={variant.id} output={output} variant={variant} step={step} mayEdit={mayEdit} editReason={editReason} />
      ))}
    </div>
  );
}
