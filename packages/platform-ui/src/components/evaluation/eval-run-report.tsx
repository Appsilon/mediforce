'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  describeAcceptanceCriteria,
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

function percent(value: number | null): string {
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Agent-reported confidence against the actual pass rate, bin by bin, and what it recommends for routing. */
function ConfidenceSection({ variant }: { variant: EvalRunVariantReport }) {
  const { confidence, recommendation } = variant;
  return (
    <div className="space-y-1 text-xs" data-testid="confidence-calibration">
      {confidence !== null && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Confidence calibration: ECE {confidence.ece.toFixed(3)} over {confidence.count} trial(s)
          </summary>
          <table className="mt-1 text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left"><th className="pr-3 font-medium">Confidence</th><th className="pr-3 font-medium">Trials</th><th className="pr-3 font-medium">Mean confidence</th><th className="font-medium">Passed</th></tr>
            </thead>
            <tbody>
              {confidence.bins.map((bin) => (
                <tr key={bin.lower}>
                  <td className="pr-3">{bin.lower.toFixed(1)}–{bin.upper.toFixed(1)}</td>
                  <td className="pr-3">{bin.count}</td>
                  <td className="pr-3">{percent(bin.meanConfidence)}</td>
                  <td>{percent(bin.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {recommendation !== null && (
        <p data-testid="control-recommendation">
          <span className="font-medium">
            Routing: <ControlModeBadge executor="agent" autonomyLevel={recommendation.autonomyLevel} showNumber />
            {recommendation.confidenceThreshold !== null && ` above confidence ${recommendation.confidenceThreshold}`}
          </span>
          {recommendation.coverage !== null && <span className="text-muted-foreground"> ({percent(recommendation.coverage)} of outputs unreviewed)</span>}
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
function SignQualificationForm({ step, evalRunId, briefVersion, variant, onDone }: {
  step: EvaluatedStep;
  evalRunId: string;
  briefVersion: number;
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
      <p>{qualificationSignatureMeaning(briefVersion)}</p>
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
  if (evalRun.briefVersion === null) return 'The step had no Evaluation Brief when this run was prepared';
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
      <ConfidenceSection variant={variant} />
      {signing && output.evalRun.briefVersion !== null ? (
        <SignQualificationForm
          step={step}
          evalRunId={output.evalRun.id}
          briefVersion={output.evalRun.briefVersion}
          variant={variant}
          onDone={() => setSigning(false)}
        />
      ) : (
        <InstantTooltip label={blocked ?? undefined}>
          <span className="inline-flex">
            <button type="button" className={buttonClass} disabled={blocked !== null} onClick={() => setSigning(true)} data-testid="sign-qualification">
              Sign Step Qualification
            </button>
          </span>
        </InstantTooltip>
      )}
    </div>
  );
}

/** Each challenger against the champion: a difference is called only when the Wilson intervals do not overlap. */
function Comparison({ comparison, labels }: { comparison: readonly VariantComparison[]; labels: ReadonlyMap<string, string> }) {
  return (
    <div className="space-y-2 border-t pt-3" data-testid="variant-comparison">
      {comparison.map((challenger) => (
        <div key={challenger.variantId} className="space-y-1">
          <p className="text-xs font-medium">{labels.get(challenger.variantId) ?? challenger.variantId} against the current step</p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left"><th className="font-medium">Evaluator</th><th className="font-medium">Current</th><th className="font-medium">Challenger</th><th className="font-medium">Δ</th><th className="font-medium">Verdict</th></tr>
            </thead>
            <tbody>
              {challenger.evaluators.map((evaluator) => (
                <tr key={evaluator.evaluatorId} className="border-t">
                  <td className="py-1">{evaluator.name}</td>
                  <td>{percent(evaluator.championPassRate)}</td>
                  <td>{percent(evaluator.challengerPassRate)}</td>
                  <td>{evaluator.delta === null ? '—' : `${evaluator.delta >= 0 ? '+' : ''}${Math.round(evaluator.delta * 100)} pp`}</td>
                  <td className={cn(evaluator.verdict === 'better' && 'text-green-700 dark:text-green-400', evaluator.verdict === 'worse' && 'text-red-700 dark:text-red-400')}>
                    {evaluator.verdict.replace(/_/g, ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground text-xs">
            {challenger.meanCostDeltaUsd !== null && `Mean cost ${challenger.meanCostDeltaUsd >= 0 ? '+' : ''}$${challenger.meanCostDeltaUsd.toFixed(4)} per trial. `}
            {challenger.meanDurationDeltaMs !== null && `Mean duration ${challenger.meanDurationDeltaMs >= 0 ? '+' : ''}${(challenger.meanDurationDeltaMs / 1000).toFixed(1)}s.`}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * An Eval Run's report (ADR-0023 D5, D10): per variant, every Evaluator's pass
 * rate with its Wilson 95% interval, pass@k, pass^k and flakiness, the verdict
 * on each Acceptance Criterion, confidence calibration and routing — then each
 * challenger against the champion. A person signs a Step Qualification for a
 * variant from here.
 */
export function EvalRunReport({ output, step, mayEdit, editReason }: {
  output: EvalRunOutput;
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const { evalRun, report, trials } = output;
  const labels = new Map(report.variants.map((variant) => [variant.id, variant.label]));
  return (
    <div className="space-y-3" data-testid="eval-run-report">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{report.trials.scored}/{report.trials.total} trials scored</span>
        {report.trials.failed > 0 && <span>{report.trials.failed} failed</span>}
        {report.trials.skipped > 0 && <span>{report.trials.skipped} skipped</span>}
        {report.trials.inProgress > 0 && (
          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{report.trials.inProgress} in progress</span>
        )}
        <span>spent ${report.costUsd.toFixed(4)} of ${evalRun.budgetUsd}</span>
        <span>{report.inputTokens + report.outputTokens} tokens</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {evalRun.acceptanceCriteria === null
          ? 'No Acceptance Criteria were frozen into this run, so nothing is judged.'
          : `Judged against ${describeAcceptanceCriteria(evalRun.acceptanceCriteria)}.`}
      </p>
      {report.variants.map((variant) => (
        <VariantReport key={variant.id} output={output} variant={variant} step={step} mayEdit={mayEdit} editReason={editReason} />
      ))}
      {report.comparison.length > 0 && <Comparison comparison={report.comparison} labels={labels} />}
      {trials.some((trial) => trial.error !== null) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Trial problems</summary>
          <ul className="mt-1 space-y-1">
            {trials.filter((trial) => trial.error !== null).map((trial) => (
              <li key={trial.id}><span className="font-mono">{trial.agentRunId ?? trial.id.slice(0, 8)}</span> ({labels.get(trial.variantId) ?? trial.variantId}): {trial.error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
