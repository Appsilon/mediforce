import type { EvalOptimisationOutput, OptimisationSplitResult } from '@mediforce/platform-api/contract';
import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson, type OutputSink } from '../output';
import { STEP_ARGS, stepFrom } from './eval-step-args';

function split(result: OptimisationSplitResult): string {
  if (result.cases === 0) return 'no cases';
  if (result.passRate === null) return `${result.cases} case(s), none graded`;
  return `${result.passes}/${result.graded} ${(result.passRate * 100).toFixed(0)}% [${((result.wilsonLower ?? 0) * 100).toFixed(0)}–${((result.wilsonUpper ?? 0) * 100).toFixed(0)}%]`;
}

function printOptimisation(output: OutputSink, { optimisation, evalRun, spentUsd, baseline, ranking }: EvalOptimisationOutput): void {
  const job = optimisation.jobCostUsd === null ? 'job running' : `job $${optimisation.jobCostUsd}`;
  output.stdout(`${optimisation.id}  ${optimisation.status}  budget $${optimisation.budgetUsd}, spent ${spentUsd === null ? 'unknown' : `$${spentUsd.toFixed(4)}`} (${job})  from Eval Run ${optimisation.sourceEvalRunId} (${optimisation.sourceVariantId})  reflection ${optimisation.reflectionModel}`);
  if (optimisation.error !== null) output.stdout(`error: ${optimisation.error}`);
  if (evalRun !== null) output.stdout(`candidates run in Eval Run ${evalRun.id}: ${evalRun.status}, budget $${evalRun.budgetUsd}, spent $${evalRun.spentUsd.toFixed(4)}`);
  if (baseline !== null) output.stdout(`\nbaseline  ${baseline.label}  dev ${split(baseline.dev)}  holdout ${split(baseline.holdout)}`);
  for (const candidate of ranking) {
    output.stdout(`\n#${candidate.rank} ${candidate.variantId} — ${candidate.label}  dev ${split(candidate.dev)}  holdout ${split(candidate.holdout)}${candidate.meanCostUsd === null ? '' : `  $${candidate.meanCostUsd.toFixed(4)}/trial`}`);
    output.stdout(candidate.prompt ?? '');
  }
  if (ranking.length > 0 && evalRun !== null) {
    output.stdout(`\nApply one with: mediforce eval apply-variant --run ${evalRun.id} --variant <variantId> ...`);
  }
}

export const evalOptimiseCommand = defineCommand({
  name: 'mediforce eval optimise',
  description: 'Start a GEPA optimisation of the step\'s prompt from a finished Eval Run: a job reflects on one variant\'s dev-case trials and proposes prompts, which then run as challengers over dev and holdout. The job and that run spend at most --budget.',
  args: {
    ...STEP_ARGS,
    run: { type: 'string', required: true, description: 'The finished Eval Run to reflect on' },
    variant: { type: 'string', description: 'Its variant to reflect on (default: champion)' },
    budget: { type: 'string', required: true, description: 'The budget you grant, in USD, for the job and the candidates\' Eval Run together' },
    candidates: { type: 'string', description: 'Prompts to propose, 1–3 (default: 3)' },
    trials: { type: 'string', description: 'Trials per case in the candidates\' Eval Run (default: 1)' },
    'reflection-model': { type: 'string', description: 'The model GEPA reflects with (default: the Evaluation Assistant\'s)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const candidates = parsePositiveIntArg(args.candidates);
    const trials = parsePositiveIntArg(args.trials);
    if (candidates === 'invalid' || trials === 'invalid') {
      output.stderr('--candidates and --trials must be positive integers');
      return 2;
    }
    const budgetUsd = Number(args.budget);
    if (Number.isFinite(budgetUsd) === false || budgetUsd <= 0) {
      output.stderr('--budget must be a positive number of USD');
      return 2;
    }
    const result = await mediforce.evaluation.startOptimisation({
      ...stepFrom(args),
      evalRunId: args.run,
      budgetUsd,
      ...(args.variant !== undefined ? { variantId: args.variant } : {}),
      ...(candidates !== undefined ? { candidates } : {}),
      ...(trials !== undefined ? { trialsPerCase: trials } : {}),
      ...(args['reflection-model'] !== undefined ? { reflectionModel: args['reflection-model'] } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    printOptimisation(output, result);
    output.stdout(`Follow it with: mediforce eval optimisation ${result.optimisation.id}`);
    return 0;
  },
});

export const evalOptimisationGetCommand = defineCommand({
  name: 'mediforce eval optimisation',
  description: 'Print an optimisation: its status and spend, the step as it is, and its candidate prompts ranked by dev pass rate with their holdout results.',
  args: { optimisationId: { type: 'positional', required: true, description: 'Optimisation id' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getOptimisation({ optimisationId: args.optimisationId });
    if (jsonMode) printJson(output, result);
    else printOptimisation(output, result);
    return 0;
  },
});

export const evalOptimisationListCommand = defineCommand({
  name: 'mediforce eval optimisations',
  description: 'List a step\'s GEPA optimisations, newest first.',
  args: { ...STEP_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listOptimisations(stepFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.optimisations.length === 0) output.stdout('No optimisations.');
    for (const optimisation of result.optimisations) {
      output.stdout(`${optimisation.id}  ${optimisation.status.padEnd(10)} ${optimisation.createdAt}  budget $${optimisation.budgetUsd}  ${optimisation.candidates.length} candidate(s)${optimisation.evalRunId === null ? '' : `  Eval Run ${optimisation.evalRunId}`}`);
    }
    return 0;
  },
});
