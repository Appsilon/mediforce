import type { EvalChallenger, EvalRunOutput } from '@mediforce/platform-api/contract';
import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson, type OutputSink } from '../output';
import { readJsonFile, STEP_ARGS, stepFrom } from './eval-step-args';

function percent(value: number | null): string {
  return value === null ? '   -' : `${(value * 100).toFixed(0).padStart(3)}%`;
}

function printRun(output: OutputSink, { evalRun, report }: EvalRunOutput): void {
  const estimate = evalRun.estimate.totalUsd === null ? 'no estimate' : `est. $${evalRun.estimate.totalUsd} (${evalRun.estimate.basis})`;
  output.stdout(`${evalRun.id}  ${evalRun.status}  ${evalRun.caseIds.length} case(s) × ${evalRun.trialsPerCase} × ${evalRun.variants.length} variant(s)  budget $${evalRun.budgetUsd}, spent $${evalRun.spentUsd.toFixed(4)}  ${estimate}`);
  output.stdout(`trials: ${report.trials.scored} scored, ${report.trials.failed} failed, ${report.trials.skipped} skipped, ${report.trials.inProgress} in progress`);
  if (evalRun.acceptanceCriteria === null) output.stdout('no Acceptance Criteria frozen into this run');
  for (const variant of report.variants) {
    const patch = Object.keys(variant.patch).length === 0 ? '' : `  ${JSON.stringify(variant.patch)}`;
    output.stdout(`\n${variant.id} — ${variant.label}${patch}`);
    output.stdout('evaluator                 pass   95% CI        pass@k pass^k flaky  errors');
    for (const evaluator of variant.evaluators) {
      const interval = evaluator.wilsonLower === null ? '      -      ' : `[${percent(evaluator.wilsonLower)}, ${percent(evaluator.wilsonUpper)}]`;
      const counted = evaluator.counted ? '' : `  not counted (${evaluator.reason})`;
      output.stdout(`${evaluator.name.padEnd(24)} ${percent(evaluator.passRate)}  ${interval}  ${percent(evaluator.passAtK)}  ${percent(evaluator.passHatK)} ${percent(evaluator.flakiness)}  ${String(evaluator.errors).padStart(3)}${counted}`);
    }
    for (const verdict of variant.criteria) {
      output.stdout(`criterion ${verdict.severity}: ${verdict.status.replace('_', ' ')} — ${verdict.reason}`);
    }
    if (variant.confidence !== null) output.stdout(`confidence: ECE ${variant.confidence.ece.toFixed(3)} over ${variant.confidence.count} trial(s)`);
    if (variant.recommendation !== null) {
      const threshold = variant.recommendation.confidenceThreshold === null ? '' : ` above confidence ${variant.recommendation.confidenceThreshold}`;
      output.stdout(`routing: ${variant.recommendation.controlMode}${threshold} — ${variant.recommendation.reason}`);
    }
  }
  for (const comparison of report.comparison) {
    output.stdout(`\n${comparison.variantId} vs champion:`);
    for (const evaluator of comparison.evaluators) {
      const delta = evaluator.delta === null ? '-' : `${evaluator.delta >= 0 ? '+' : ''}${(evaluator.delta * 100).toFixed(0)}pp`;
      output.stdout(`  ${evaluator.name.padEnd(24)} ${percent(evaluator.championPassRate)} → ${percent(evaluator.challengerPassRate)}  ${delta}  ${evaluator.verdict.replace(/_/g, ' ')}`);
    }
  }
}

export const evalRunPrepareCommand = defineCommand({
  name: 'mediforce eval run-prepare',
  description: 'Prepare an Eval Run of a step and print its cost estimate. Nothing runs until run-start.',
  args: {
    ...STEP_ARGS,
    dataset: { type: 'string', description: 'Eval Dataset version id (default: the newest)' },
    trials: { type: 'string', description: 'Trials per case (default: 3)' },
    concurrency: { type: 'string', description: 'Trials at once (default: 2)' },
    budget: { type: 'string', description: 'Spend cap in USD (default: 1.5× the estimate)' },
    challengers: { type: 'string', description: 'JSON file with up to 3 challengers: [{ "label": "GPT-5", "patch": { "model": "openai/gpt-5" } }]' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const trials = parsePositiveIntArg(args.trials);
    const concurrency = parsePositiveIntArg(args.concurrency);
    if (trials === 'invalid' || concurrency === 'invalid') {
      output.stderr('--trials and --concurrency must be positive integers');
      return 2;
    }
    const result = await mediforce.evaluation.prepareRun({
      ...stepFrom(args),
      ...(args.dataset !== undefined ? { datasetVersionId: args.dataset } : {}),
      ...(trials !== undefined ? { trialsPerCase: trials } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(args.budget !== undefined ? { budgetUsd: Number(args.budget) } : {}),
      ...(args.challengers !== undefined ? { challengers: readJsonFile(args.challengers) as EvalChallenger[] } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    printRun(output, result);
    output.stdout(`Start it with: mediforce eval run-start ${result.evalRun.id} --confirm-budget ${result.evalRun.budgetUsd}`);
    return 0;
  },
});

export const evalRunStartCommand = defineCommand({
  name: 'mediforce eval run-start',
  description: 'Start a prepared Eval Run, confirming the budget it may spend.',
  args: {
    evalRunId: { type: 'positional', required: true, description: 'Eval Run id' },
    'confirm-budget': { type: 'string', required: true, description: 'The run\'s budget in USD, as run-prepare printed it' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.startRun({
      evalRunId: args.evalRunId,
      confirmedBudgetUsd: Number(args['confirm-budget']),
    });
    if (jsonMode) printJson(output, result);
    else printRun(output, result);
    return 0;
  },
});

export const evalRunGetCommand = defineCommand({
  name: 'mediforce eval report',
  description: 'Print an Eval Run and its report: per variant and Evaluator pass rate, Wilson 95% interval, pass@k, pass^k, flakiness; criteria verdicts, routing, and each challenger against the champion.',
  args: { evalRunId: { type: 'positional', required: true, description: 'Eval Run id' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getRun({ evalRunId: args.evalRunId });
    if (jsonMode) printJson(output, result);
    else printRun(output, result);
    return 0;
  },
});

export const evalRunListCommand = defineCommand({
  name: 'mediforce eval run-list',
  description: 'List a step\'s Eval Runs, newest first.',
  args: { ...STEP_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listRuns(stepFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.evalRuns.length === 0) output.stdout('No Eval Runs.');
    for (const run of result.evalRuns) {
      output.stdout(`${run.id}  ${run.status.padEnd(15)} ${run.createdAt}  budget $${run.budgetUsd}, spent $${run.spentUsd.toFixed(4)}`);
    }
    return 0;
  },
});

export const evalRunCancelCommand = defineCommand({
  name: 'mediforce eval run-cancel',
  description: 'Cancel an Eval Run: no new trials start; running ones finish and are scored.',
  args: { evalRunId: { type: 'positional', required: true, description: 'Eval Run id' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.cancelRun({ evalRunId: args.evalRunId });
    if (jsonMode) printJson(output, result);
    else printRun(output, result);
    return 0;
  },
});
