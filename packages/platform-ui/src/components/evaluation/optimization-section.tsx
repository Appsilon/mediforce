'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { isEmptyVariant, type EvalVariantPatch, type EvaluationSubject } from '@mediforce/platform-core';
import type { ComparisonOutput, ComparisonRun, EvalRunOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { evalTrialHref } from '@/lib/evaluation-subject';
import { formatCostUsd } from '@/lib/format';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { ModelPicker } from '@/components/workflows/workflow-editor/model-picker';
import { useComparison, useComparisonOutputs, useComparisons, useEvalRuns, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { AcceptanceBadge, EvalRunStatusBadge, TrialResultBadge } from './eval-run-badges';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';
import { DetailsRow, DisclosureButton, TableHead, tableWrapperClass } from './evaluation-table';
import { FormDialog, StartEvalRunDialog, parseBudgetUsd, parseTrialsPerCase, type StepEvaluation } from './step-evaluation-sections';

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="sr-only">{title}</h3>
      {action !== undefined && <div className="flex justify-end gap-2">{action}</div>}
      {children}
    </section>
  );
}

function describeVariant(patch: EvalVariantPatch): string {
  const parts = [...(patch.model !== undefined ? [patch.model] : []), ...(patch.prompt !== undefined ? ['own prompt'] : [])];
  return parts.length === 0 ? 'baseline' : parts.join(', ');
}

type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** shortcut: skips the diff above ~450 lines a side (O(n*m) DP); falls back to plain before/after text. */
function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 200_000) return null;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { lines.push({ kind: 'same', text: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { lines.push({ kind: 'removed', text: a[i]! }); i++; }
    else { lines.push({ kind: 'added', text: b[j]! }); j++; }
  }
  while (i < a.length) { lines.push({ kind: 'removed', text: a[i]! }); i++; }
  while (j < b.length) { lines.push({ kind: 'added', text: b[j]! }); j++; }
  return lines;
}

interface VariantDraft { model: string; promptEnabled: boolean; prompt: string }

function emptyVariant(currentPrompt: string): VariantDraft {
  return { model: '', promptEnabled: false, prompt: currentPrompt };
}

function variantPatch(draft: VariantDraft, currentModel: string): EvalVariantPatch | null {
  const patch: EvalVariantPatch = {
    ...(draft.model !== '' && draft.model !== currentModel ? { model: draft.model } : {}),
    ...(draft.promptEnabled ? { prompt: draft.prompt } : {}),
  };
  return isEmptyVariant(patch) ? null : patch;
}

function VariantEditor({ index, draft, currentModel, currentPrompt, onChange, onRemove }: {
  index: number;
  draft: VariantDraft;
  currentModel: string;
  currentPrompt: string;
  onChange: (draft: VariantDraft) => void;
  onRemove: () => void;
}) {
  const diff = draft.promptEnabled && draft.prompt !== currentPrompt ? diffLines(currentPrompt, draft.prompt) : null;
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`variant-editor-${index}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Variant {index + 1}</span>
        <button type="button" className={buttonClass} onClick={onRemove}>Remove</button>
      </div>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Model</span>
        <ModelPicker value={draft.model || undefined} onChange={(model) => onChange({ ...draft, model: model ?? '' })} defaultModel={currentModel} defaultLabel="Baseline model" className={inputClass} />
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={draft.promptEnabled} onChange={(event) => onChange({ ...draft, promptEnabled: event.target.checked })} />
        Change the prompt
      </label>
      {draft.promptEnabled && (
        <div className="space-y-1">
          <textarea
            aria-label={`Variant ${index + 1} prompt`}
            className={cn(inputClass, 'min-h-32 w-full font-mono text-xs')}
            value={draft.prompt}
            onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
          />
          {diff === null ? null : diff.some((line) => line.kind !== 'same') && (
            <div className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px]" data-testid="prompt-diff">
              {diff.map((line, lineIndex) => (
                <div
                  key={lineIndex}
                  className={cn(
                    line.kind === 'added' && 'bg-green-500/15 text-green-800 dark:text-green-300',
                    line.kind === 'removed' && 'bg-red-500/15 text-red-800 line-through dark:text-red-300',
                  )}
                >
                  {line.text === '' ? ' ' : line.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewComparisonDialog({ step, definitionVersion, datasets, currentModel, currentPrompt, onClose }: {
  step: EvaluationSubject;
  definitionVersion: number | null;
  datasets: StepEvaluation['datasets'];
  currentModel: string;
  currentPrompt: string;
  onClose: () => void;
}) {
  const [variants, setVariants] = React.useState<VariantDraft[]>([emptyVariant(currentPrompt)]);
  const [trialsText, setTrialsText] = React.useState('3');
  const [budgetText, setBudgetText] = React.useState('');
  const [datasetVersionId, setDatasetVersionId] = React.useState<string | undefined>(undefined);
  const [prepared, setPrepared] = React.useState<ComparisonOutput | null>(null);
  const versions = datasets.data?.datasets ?? [];
  const trials = parseTrialsPerCase(trialsText);
  const budgetUsdPerRun = parseBudgetUsd(budgetText);
  const patches = variants.map((draft) => variantPatch(draft, currentModel)).filter((patch): patch is EvalVariantPatch => patch !== null);

  const prepare = useStepEvaluationMutation(step, () => mediforce.evaluation.prepareComparison({
    ...step,
    variants: patches,
    ...(definitionVersion === null ? {} : { definitionVersion }),
    ...(datasetVersionId === undefined ? {} : { datasetVersionId }),
    trialsPerCase: trials ?? undefined,
    ...(budgetUsdPerRun === null ? {} : { budgetUsdPerRun }),
  }));
  const start = useStepEvaluationMutation(step, (comparisonId: string) =>
    mediforce.evaluation.startComparison({ comparisonId, confirmedBudgetUsd: prepared!.comparison.budgetUsd }));

  if (prepared !== null) {
    return (
      <StartEvalRunDialog
        trials={null}
        estimatedUsd={null}
        budget={{ kind: 'set', budgetUsd: prepared.comparison.budgetUsd }}
        starting={start.isPending}
        error={start.error instanceof Error ? start.error : null}
        onStart={() => start.mutate(prepared.comparison.id, { onSuccess: onClose })}
        onClose={onClose}
      />
    );
  }

  return (
    <FormDialog title="New Comparison" description="A baseline and up to four Variants, run on the same cases." testId="comparison-dialog" onClose={onClose}>
      <div className="space-y-3">
        {variants.map((draft, index) => (
          <VariantEditor
            key={index}
            index={index}
            draft={draft}
            currentModel={currentModel}
            currentPrompt={currentPrompt}
            onChange={(next) => setVariants(variants.map((variant, at) => (at === index ? next : variant)))}
            onRemove={() => setVariants(variants.filter((_variant, at) => at !== index))}
          />
        ))}
        {variants.length < 4 && (
          <button type="button" className={buttonClass} onClick={() => setVariants([...variants, emptyVariant(currentPrompt)])}>Add a Variant</button>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Dataset version
            <select className={inputClass} value={datasetVersionId ?? versions[0]?.id ?? ''} onChange={(event) => setDatasetVersionId(event.target.value)}>
              {versions.map((version) => <option key={version.id} value={version.id}>v{version.version} ({version.caseIds.length} cases)</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Trials per case
            <input type="number" min={1} max={10} className={cn(inputClass, 'w-16')} value={trialsText} onChange={(event) => setTrialsText(event.target.value)} />
          </label>
          <label className="flex items-center gap-1">Budget per run $
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'w-24')} placeholder="auto" value={budgetText} onChange={(event) => setBudgetText(event.target.value)} />
          </label>
        </div>
        {prepare.error !== null && <p className="text-xs text-destructive">{prepare.error.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={patches.length === 0 || trials === null || versions.length === 0 || prepare.isPending}
            onClick={() => prepare.mutate(undefined, { onSuccess: setPrepared })}
            data-testid="prepare-comparison"
          >
            {prepare.isPending ? 'Preparing…' : 'Prepare'}
          </button>
        </div>
      </div>
    </FormDialog>
  );
}

function BestCallBadge({ variants }: { variants: ComparisonOutput['variants'] }) {
  const calls = variants.flatMap((variant) => variant.calls.filter((call) => call.scope === variant.recommendationScope));
  const better = calls.some((call) => call.call === 'better');
  const worse = calls.some((call) => call.call === 'worse');
  const label = better ? 'better' : worse ? 'worse' : calls.length === 0 ? '—' : calls.every((call) => call.call === 'too_few_cases') ? 'too few cases' : 'no clear difference';
  return <span className={cn('text-xs font-medium', better && 'text-green-700 dark:text-green-400', worse && 'text-red-700 dark:text-red-400')}>{label}</span>;
}

function QualityCostScatter({ baseline, variants }: { baseline: ComparisonRun; variants: readonly ComparisonRun[] }) {
  const width = 260;
  const height = 160;
  const pad = 28;
  const points = [{ label: 'baseline', run: baseline }, ...variants.map((variant, index) => ({ label: `v${index + 1}`, run: variant }))]
    .map((point) => {
      const counted = point.run.evaluators.filter((evaluator) => evaluator.counted);
      const quality = counted.length === 0 ? null : counted.reduce((sum, evaluator) => sum + (evaluator.passRate ?? 0), 0) / counted.length;
      const cost = (point.run.meanAgentCostUsd ?? 0) + (point.run.meanJudgeCostUsd ?? 0);
      return { ...point, quality, cost };
    })
    .filter((point): point is typeof point & { quality: number } => point.quality !== null);
  if (points.length === 0) return null;
  const maxCost = Math.max(...points.map((point) => point.cost), 0.0001);
  const x = (cost: number) => pad + (cost / maxCost) * (width - 2 * pad);
  const y = (quality: number) => height - pad - quality * (height - 2 * pad);
  return (
    <svg width={width} height={height} role="img" aria-label="Quality versus cost, one point per run" data-testid="quality-cost-scatter">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <text x={pad} y={height - 8} className="fill-current text-[9px] text-muted-foreground">cost →</text>
      <text x={4} y={pad} className="fill-current text-[9px] text-muted-foreground">quality ↑</text>
      {points.map((point) => (
        <g key={point.label}>
          <circle cx={x(point.cost)} cy={y(point.quality)} r={4} className={point.label === 'baseline' ? 'fill-muted-foreground' : 'fill-primary'} />
          <text x={x(point.cost) + 6} y={y(point.quality) - 6} className="fill-current text-[9px]">{point.label}</text>
        </g>
      ))}
    </svg>
  );
}

function EvaluatorCallsTable({ baseline, variant }: { baseline: ComparisonRun; variant: ComparisonOutput['variants'][number] }) {
  const names = new Map(baseline.evaluators.map((evaluator) => [evaluator.evaluatorId, evaluator.name]));
  return (
    <table className="w-full text-xs">
      <TableHead columns={[
        { key: 'evaluator', label: 'Evaluator' },
        { key: 'scope', label: 'Scope' },
        { key: 'call', label: 'Call' },
        { key: 'wlt', label: 'Win/loss/tie' },
        { key: 'p', label: 'p' },
      ]} />
      <tbody>
        {variant.calls.map((call, index) => (
          <tr key={index} className={cn('border-b last:border-0', call.scope === variant.recommendationScope && 'bg-primary/5')}>
            <td className="px-3 py-1.5">{names.get(call.evaluatorId) ?? call.evaluatorId}</td>
            <td className="px-3 py-1.5">{call.scope}</td>
            <td className={cn('px-3 py-1.5 font-medium', call.call === 'better' && 'text-green-700 dark:text-green-400', call.call === 'worse' && 'text-red-700 dark:text-red-400')}>
              {call.call === 'no_clear_difference' ? 'no clear difference' : call.call === 'too_few_cases' ? 'too few cases' : call.call}
            </td>
            <td className="px-3 py-1.5">{call.wins}/{call.losses}/{call.ties}</td>
            <td className="px-3 py-1.5">{call.pValue === null ? '—' : call.pValue.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CaseDrillDown({ step, baseline, variants }: { step: EvaluationSubject; baseline: ComparisonRun; variants: readonly ComparisonRun[] }) {
  const runs = [baseline, ...variants];
  const outputs = useEvalRuns(runs.map((run) => run.evalRun.id));
  if (outputs.some((output) => output.data === undefined)) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  const loaded = outputs.map((output) => output.data!);
  const caseIds = [...new Set(loaded[0]!.trials.map((trial) => trial.caseId))];
  const caseName = new Map(loaded[0]!.report.trialResults.map((result) => [result.trialId, result.caseName]));
  const trialsOf = (output: EvalRunOutput, caseId: string) => output.trials.filter((trial) => trial.caseId === caseId);
  const passedOf = (output: EvalRunOutput, trialId: string) => output.report.trialResults.find((result) => result.trialId === trialId)?.passed ?? null;
  return (
    <div className={tableWrapperClass} data-testid="comparison-case-drilldown">
      <table className="w-full text-xs">
        <TableHead columns={[{ key: 'case', label: 'Case' }, { key: 'baseline', label: 'Baseline' }, ...variants.map((variant, index) => ({ key: `v${index}`, label: describeVariant(variant.evalRun.variant ?? {}) }))]} />
        <tbody>
          {caseIds.map((caseId) => {
            const name = trialsOf(loaded[0]!, caseId).map((trial) => caseName.get(trial.id)).find((value) => value !== undefined) ?? caseId.slice(0, 8);
            return (
              <tr key={caseId} className="border-b last:border-0" data-testid="comparison-case-row">
                <td className="px-3 py-2">{name}</td>
                {loaded.map((output, runIndex) => (
                  <td key={runIndex} className="space-x-1 px-3 py-2">
                    {trialsOf(output, caseId).map((trial) => (
                      <Link key={trial.id} href={evalTrialHref(step, runs[runIndex]!.evalRun.id, trial.id)} className="inline-flex">
                        <TrialResultBadge passed={passedOf(output, trial.id)} />
                      </Link>
                    ))}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonReport({ step, comparisonId, mayRun }: { step: EvaluationSubject; comparisonId: string; mayRun: boolean }) {
  const query = useComparison(step, comparisonId);
  if (query.data === undefined) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" data-testid="comparison-report-loading" />;
  const { comparison, baseline, variants } = query.data;
  return (
    <div className="space-y-4" data-testid="comparison-report">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{comparison.trialsPerCase} trial(s)/case</span>
        <span>Budget ${comparison.budgetUsd}</span>
        {comparison.baselineReused && <span>Baseline reused</span>}
      </div>
      <QualityCostScatter baseline={baseline} variants={variants} />
      {variants.map((variant, index) => (
        <div key={index} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <span>{describeVariant(variant.evalRun.variant ?? {})}</span>
            <AcceptanceBadge acceptance={variant.acceptance} />
            {mayRun && (
              <InstantTooltip label="Applies a winning Variant for real once O4 (apply-variant) merges to main.">
                <span className="inline-flex"><button type="button" className={buttonClass} disabled>Apply</button></span>
              </InstantTooltip>
            )}
          </div>
          <EvaluatorCallsTable baseline={baseline} variant={variant} />
        </div>
      ))}
      <CaseDrillDown step={step} baseline={baseline} variants={variants} />
    </div>
  );
}

export function OptimizationSection({ step, definitionVersion, datasets, currentModel, currentPrompt, mayRun, runReason }: {
  step: EvaluationSubject;
  definitionVersion: number | null;
  datasets: StepEvaluation['datasets'];
  /** Undefined while the subject's agent is still loading. */
  currentModel: string | undefined;
  currentPrompt: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const comparisons = useComparisons(step);
  const rows = comparisons.data?.comparisons ?? [];
  const outputs = useComparisonOutputs(step, rows);
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const canCreate = currentModel !== undefined && currentPrompt !== undefined;

  return (
    <Section
      title="Optimization"
      action={(
        <InstantTooltip label={mayRun ? undefined : runReason}>
          <span className="inline-flex">
            <button type="button" className={primaryButtonClass} disabled={!mayRun || !canCreate} onClick={() => setCreating(true)} data-testid="new-comparison">
              New Comparison
            </button>
          </span>
        </InstantTooltip>
      )}
    >
      {comparisons.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Comparisons yet.</p>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-sm" data-testid="comparisons-table">
            <TableHead columns={[
              { key: 'created', label: 'Created' },
              { key: 'status', label: 'Status' },
              { key: 'variants', label: 'Variants' },
              { key: 'call', label: 'Best call' },
              { key: 'spend', label: 'Spend' },
              { key: 'actions', label: '' },
            ]} />
            <tbody>
              {rows.map((comparison, index) => {
                const output = outputs[index]?.data;
                const spent = output === undefined ? null
                  : output.baseline.evalRun.spentUsd + output.variants.reduce((sum, variant) => sum + variant.evalRun.spentUsd, 0);
                return (
                  <React.Fragment key={comparison.id}>
                    <tr className="border-b last:border-0 hover:bg-muted/30" data-testid="comparison-row">
                      <td className="px-3 py-2 text-xs text-muted-foreground" title={comparison.createdAt}>
                        {formatDistanceToNow(new Date(comparison.createdAt), { addSuffix: true })}
                      </td>
                      <td className="px-3 py-2"><EvalRunStatusBadge status={comparison.status} /></td>
                      <td className="px-3 py-2 text-xs">{output === undefined ? '…' : output.variants.map((variant) => describeVariant(variant.evalRun.variant ?? {})).join('; ')}</td>
                      <td className="px-3 py-2">{output === undefined ? '—' : <BestCallBadge variants={output.variants} />}</td>
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{spent === null ? '—' : `${formatCostUsd(spent)} of $${comparison.budgetUsd}`}</td>
                      <td className="px-3 py-2 text-right">
                        <DisclosureButton open={openId === comparison.id} onToggle={() => setOpenId(openId === comparison.id ? null : comparison.id)} data-testid="comparison-toggle">
                          Report
                        </DisclosureButton>
                      </td>
                    </tr>
                    {openId === comparison.id && (
                      <DetailsRow columns={6} testId="comparison-report-row">
                        <ComparisonReport step={step} comparisonId={comparison.id} mayRun={mayRun} />
                      </DetailsRow>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && canCreate && (
        <NewComparisonDialog step={step} definitionVersion={definitionVersion} datasets={datasets} currentModel={currentModel} currentPrompt={currentPrompt} onClose={() => setCreating(false)} />
      )}
    </Section>
  );
}
