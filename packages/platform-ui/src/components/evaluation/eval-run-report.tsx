'use client';

import * as React from 'react';
import {
  calibrateJudgeReviews,
  qualificationSignatureMeaning,
  type AcceptanceCriterionVerdict,
  type EvalRunVariantReport,
  type EvaluatedStep,
  type JudgeVerdict,
  type StepVariantPatch,
  type VariantComparison,
} from '@mediforce/platform-core';
import type { EvalRunOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { useAuth } from '@/contexts/auth-context';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
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

function TableTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

/** Each Acceptance Criterion against the counted Evaluators of its severity: how many reached it, and the trials they graded. */
function CriteriaTable({ variant }: { variant: EvalRunVariantReport }) {
  return (
    <div>
    <TableTitle>Acceptance criteria</TableTitle>
    <table className="w-full text-xs" data-testid="criteria-verdicts">
      <thead className="text-muted-foreground">
        <tr className="text-left">
          <th className="py-1 font-medium">Criterion</th>
          <th className="py-1 font-medium">Required</th>
          <th className="py-1 font-medium">Evaluators met</th>
          <th className="py-1 font-medium">Passed</th>
          <th className="py-1 font-medium">Failed</th>
          <th className="py-1 font-medium">Pass rate</th>
          <th className="py-1 font-medium">Detail</th>
        </tr>
      </thead>
      <tbody>
        {variant.criteria.map((verdict) => {
          const counted = variant.evaluators.filter((evaluator) => evaluator.counted === true && evaluator.severity === verdict.severity);
          const passes = counted.reduce((sum, evaluator) => sum + evaluator.passes, 0);
          const failures = counted.reduce((sum, evaluator) => sum + evaluator.failures, 0);
          const metCount = verdict.evaluators.filter((evaluator) => evaluator.met === true).length;
          return (
            <tr key={verdict.severity} className="border-t align-top" data-testid={`criterion-${verdict.severity}`}>
              <td className="py-1.5">
                <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', VERDICT_CLASSES[verdict.status])}>
                  {verdict.severity} {verdict.status === 'not_evaluable' ? 'not judged' : verdict.status}
                </span>
              </td>
              <td className="py-1.5">
                pass rate ≥ {percent(verdict.criterion.minPassRate)}
                {verdict.criterion.minPassHatK !== undefined && `, pass^k ≥ ${percent(verdict.criterion.minPassHatK)}`}
              </td>
              <td className="py-1.5">{metCount}/{verdict.evaluators.length}</td>
              <td className="py-1.5">{passes}</td>
              <td className="py-1.5">{failures}</td>
              <td className="py-1.5">{percent(passes + failures === 0 ? null : passes / (passes + failures))}</td>
              <td className="py-1.5 text-muted-foreground">{verdict.reason}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function EvaluatorTable({ variant, k }: { variant: EvalRunVariantReport; k: number }) {
  return (
    <div>
    <TableTitle>Evaluators</TableTitle>
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
    </div>
  );
}

/**
 * Whether the models grading this variant can be trusted: the confidence each
 * gave its verdict against whether a person accepted or denied that verdict.
 */
function CalibrationSection({ verdicts }: { verdicts: readonly JudgeVerdict[] }) {
  const calibration = calibrateJudgeReviews(verdicts);
  const accepted = verdicts.filter((verdict) => verdict.review?.decision === 'accepted').length;
  const denied = verdicts.filter((verdict) => verdict.review?.decision === 'denied').length;
  return (
    <p className="text-xs" data-testid="verdict-calibration">
      <InstantTooltip label="Expected calibration error: the average gap between the confidence a model gave its verdict and the share of those verdicts a person accepted, weighted by how many verdicts each confidence bin holds. 0 means its confidence matches the reviews exactly; 0.2 means it is off by 20 points on average.">
        <span className="font-medium underline decoration-dotted">Calibration error</span>
      </InstantTooltip>{' '}
      {calibration === null ? (
        <span className="text-muted-foreground">Waiting for model verdicts human validation</span>
      ) : (
        <>
          <span className="font-medium">{calibration.ece.toFixed(3)}</span>
          <span className="text-muted-foreground"> over {calibration.count} reviewed model verdict(s) — {accepted} accepted, {denied} denied. 0 is a perfect match.</span>
        </>
      )}
    </p>
  );
}

/**
 * Signing a Step Qualification for one variant (ADR-0023 D10), labelled as an
 * approval of the step configuration: the person
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
      <p className="font-medium">Approve the {variant.label} configuration (e-signature)</p>
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

const APPROVE_EXPLANATION = 'Record your signed approval that this exact step configuration — model, prompt, skills, tools — is fit for use, based on this Eval Run. It is shown on the step and marked out of date once the step changes; nothing is blocked without one.';

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
    <div className="space-y-5 border-t pt-4 first:border-t-0 first:pt-0" data-testid="variant-report">
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
      {variant.criteria.length > 0 && <CriteriaTable variant={variant} />}
      {comparison !== undefined && <ComparisonTable comparison={comparison} />}
      <CalibrationSection verdicts={output.report.judgeVerdicts.filter((verdict) => verdict.variantId === variant.id)} />
      {signing ? (
        <SignQualificationForm
          step={step}
          evalRunId={output.evalRun.id}
          variant={variant}
          onDone={() => setSigning(false)}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <InstantTooltip label={blocked ?? APPROVE_EXPLANATION}>
            <span className="inline-flex">
              <button type="button" className={buttonClass} disabled={blocked !== null} onClick={() => setSigning(true)} data-testid="sign-qualification">
                Approve step configuration
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
      <TableTitle>Against the step as it is</TableTitle>
      <p className="text-muted-foreground">
        {comparison.meanCostDeltaUsd !== null && `mean cost ${comparison.meanCostDeltaUsd >= 0 ? '+' : ''}$${comparison.meanCostDeltaUsd.toFixed(4)}`}
        {comparison.meanDurationDeltaMs !== null && `${comparison.meanCostDeltaUsd !== null ? ' · ' : ''}mean time ${comparison.meanDurationDeltaMs >= 0 ? '+' : ''}${(comparison.meanDurationDeltaMs / 1000).toFixed(1)}s`}
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
 * and how well the grading models' confidence matches a person's review of
 * their verdicts. A person signs a Step Qualification for a variant from here.
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
        {evalRun.acceptanceCriteria === null && <p>No Acceptance Criteria were frozen into this run, so nothing is judged.</p>}
        {evalRun.exampleCaseIds.length > 0 && (
          <p data-testid="example-cases-left-out">
            {evalRun.exampleCaseIds.length} case(s) left out — a variant&apos;s few-shot examples came from them.
          </p>
        )}
      </div>
      {report.variants.map((variant) => (
        <VariantReport key={variant.id} output={output} variant={variant} step={step} mayEdit={mayEdit} editReason={editReason} />
      ))}
    </div>
  );
}
