import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { EvalVariantPatchSchema, type EvalVariantPatch } from '@mediforce/platform-core';
import type { ComparisonOutput, ComparisonRun } from '@mediforce/platform-api/contract';
import { defineCommand, parsePositiveIntArg, parsePositiveNumberArg } from '../define-command';
import { printJson, type OutputSink } from '../output';
import { SUBJECT_ARGS, subjectFrom } from './eval-step-args';
import { describeVariant, percent } from './eval-runs';

const VariantListSchema = z.array(EvalVariantPatchSchema).min(1).max(4);

function variantsFile(path: string): EvalVariantPatch[] {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = VariantListSchema.safeParse(json);
  if (parsed.success === false) {
    throw new Error(`${path} is not a list of Variants: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return parsed.data;
}

function usd(value: number | null): string {
  return value === null ? '-' : `$${value.toFixed(4)}`;
}

function printRunLine(output: OutputSink, label: string, run: ComparisonRun): void {
  const evaluators = run.evaluators
    .filter((evaluator) => evaluator.counted === true)
    .map((evaluator) => `${evaluator.name} ${percent(evaluator.passRate).trim()} [${percent(evaluator.wilsonLower).trim()}, ${percent(evaluator.wilsonUpper).trim()}]`)
    .join('  ');
  output.stdout(`${label}  ${run.evalRun.id}  ${run.evalRun.status}`);
  output.stdout(`  ${evaluators}`);
  output.stdout(`  per trial: agent ${usd(run.meanAgentCostUsd)}, judge ${usd(run.meanJudgeCostUsd)}, ${run.meanDurationMs === null ? '-' : `${Math.round(run.meanDurationMs)} ms`}  tokens ${run.inputTokens} in / ${run.outputTokens} out`);
}

function printComparison(output: OutputSink, { comparison, baseline, variants }: ComparisonOutput): void {
  output.stdout(`${comparison.id}  ${comparison.status}  ${variants.length} Variant(s) × ${comparison.trialsPerCase} trial(s) per case  budget $${comparison.budgetUsd}`);
  printRunLine(output, comparison.baselineReused === true ? 'baseline (reused)' : 'baseline', baseline);
  const names = new Map(baseline.evaluators.map((evaluator) => [evaluator.evaluatorId, evaluator.name]));
  for (const variant of variants) {
    printRunLine(output, describeVariant(variant.evalRun.variant ?? {}), variant);
    for (const call of variant.calls) {
      const reads = call.scope === variant.recommendationScope ? '  ← recommendation' : '';
      const pValue = call.pValue === null ? '' : `, p=${call.pValue.toFixed(3)}`;
      output.stdout(`  ${(names.get(call.evaluatorId) ?? call.evaluatorId).padEnd(24)} ${call.scope.padEnd(7)} ${call.call.replaceAll('_', ' ')}  (${call.wins} wins, ${call.losses} losses, ${call.ties} ties${pValue})${reads}`);
    }
  }
}

export const evalComparePrepareCommand = defineCommand({
  name: 'mediforce eval compare-prepare',
  description: 'Prepare a Comparison: a baseline and one to four Variants on the same cases, with one budget. Nothing runs until compare-start.',
  args: {
    ...SUBJECT_ARGS,
    variants: { type: 'string', description: 'JSON file with a list of one to four Variants ({ "model"?, "prompt"? })' },
    model: { type: 'string', description: 'Comma-separated models, one model Variant each (added to --variants)' },
    baseline: { type: 'string', description: 'Eval Run id to reuse as the baseline (default: the newest finished run that matches)' },
    version: { type: 'string', description: 'Workflow Definition version whose step runs (default: the runnable one)' },
    dataset: { type: 'string', description: 'Eval Dataset version id (default: the newest)' },
    trials: { type: 'string', description: 'Trials per case (default: 3)' },
    concurrency: { type: 'string', description: 'Trials at once, per run (default: 2)' },
    'budget-per-run': { type: 'string', description: 'Spend cap of each run in USD (default: 1.5× its estimate)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const trials = parsePositiveIntArg(args.trials);
    const concurrency = parsePositiveIntArg(args.concurrency);
    const version = parsePositiveIntArg(args.version);
    if (trials === 'invalid' || concurrency === 'invalid' || version === 'invalid') {
      output.stderr('--trials, --concurrency and --version must be positive integers');
      return 2;
    }
    const budgetPerRun = parsePositiveNumberArg(args['budget-per-run']);
    if (budgetPerRun === 'invalid') {
      output.stderr('--budget-per-run must be a positive number');
      return 2;
    }
    const variants = [
      ...(args.variants === undefined ? [] : variantsFile(args.variants)),
      ...(args.model === undefined ? [] : args.model.split(',').map((model) => model.trim()).filter((model) => model !== '').map((model) => ({ model }))),
    ];
    if (variants.length === 0) {
      output.stderr('Name at least one Variant with --variants <file> or --model <id>');
      return 2;
    }
    const result = await mediforce.evaluation.prepareComparison({
      ...subjectFrom(args),
      variants,
      ...(args.baseline !== undefined ? { baselineEvalRunId: args.baseline } : {}),
      ...(version !== undefined ? { definitionVersion: version } : {}),
      ...(args.dataset !== undefined ? { datasetVersionId: args.dataset } : {}),
      ...(trials !== undefined ? { trialsPerCase: trials } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(budgetPerRun !== undefined ? { budgetUsdPerRun: budgetPerRun } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    printComparison(output, result);
    output.stdout(`Start it with: mediforce eval compare-start ${result.comparison.id} --confirm-budget ${result.comparison.budgetUsd}`);
    return 0;
  },
});

export const evalCompareStartCommand = defineCommand({
  name: 'mediforce eval compare-start',
  description: 'Start every run of a prepared Comparison, confirming the budget they may spend together.',
  args: {
    comparisonId: { type: 'positional', required: true, description: 'Comparison id' },
    'confirm-budget': { type: 'string', required: true, description: 'The Comparison\'s budget in USD, as compare-prepare printed it' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const confirmBudget = parsePositiveNumberArg(args['confirm-budget']);
    if (confirmBudget === undefined || confirmBudget === 'invalid') {
      output.stderr('--confirm-budget must be a positive number');
      return 2;
    }
    const result = await mediforce.evaluation.startComparison({
      comparisonId: args.comparisonId,
      confirmedBudgetUsd: confirmBudget,
    });
    if (jsonMode) printJson(output, result);
    else printComparison(output, result);
    return 0;
  },
});

export const evalCompareGetCommand = defineCommand({
  name: 'mediforce eval compare-get',
  description: 'Print a Comparison: each run\'s pass rate, cost and tokens, and each Variant against the baseline case by case.',
  args: { comparisonId: { type: 'positional', required: true, description: 'Comparison id' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getComparison({ comparisonId: args.comparisonId });
    if (jsonMode) printJson(output, result);
    else printComparison(output, result);
    return 0;
  },
});

export const evalCompareListCommand = defineCommand({
  name: 'mediforce eval compare-list',
  description: 'List a step\'s or an Agent\'s Comparisons, newest first.',
  args: { ...SUBJECT_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listComparisons(subjectFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.comparisons.length === 0) output.stdout('No Comparisons yet.');
    for (const comparison of result.comparisons) {
      output.stdout(`${comparison.id}  ${comparison.status}  budget $${comparison.budgetUsd}  ${comparison.createdAt}`);
    }
    return 0;
  },
});

export const evalCompareCancelCommand = defineCommand({
  name: 'mediforce eval compare-cancel',
  description: 'Cancel a Comparison and every run it prepared that has not finished.',
  args: { comparisonId: { type: 'positional', required: true, description: 'Comparison id' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.cancelComparison({ comparisonId: args.comparisonId });
    if (jsonMode) printJson(output, result);
    else printComparison(output, result);
    return 0;
  },
});
