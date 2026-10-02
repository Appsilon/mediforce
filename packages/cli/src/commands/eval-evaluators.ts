import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson } from '../output';
import { readJsonFile, STEP_ARGS, stepFrom } from './eval-step-args';
import type { EvaluatorView } from '@mediforce/platform-api/contract';

function describeProduction(evaluator: EvaluatorView): string {
  if (evaluator.production.active === true) return '  in production';
  return evaluator.production.reason === undefined ? '' : `  production: ${evaluator.production.reason}`;
}

function describeEvaluator(evaluator: EvaluatorView): string {
  const trust = evaluator.trust.trusted ? 'counted' : `not counted (${evaluator.trust.reason})`;
  return `${evaluator.id}  ${evaluator.name.padEnd(24)} v${evaluator.latest.version}  ${evaluator.latest.check.kind.padEnd(9)} ${evaluator.latest.severity.padEnd(8)} ${trust}${describeProduction(evaluator)}`;
}

export const evalEvaluatorListCommand = defineCommand({
  name: 'mediforce eval evaluator-list',
  description: 'List a step\'s Evaluators with their latest version and whether they count.',
  args: { ...STEP_ARGS, 'include-archived': { type: 'boolean', description: 'Include archived Evaluators' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listEvaluators({ ...stepFrom(args), includeArchived: args['include-archived'] === true ? 'true' : undefined });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.evaluators.length === 0) output.stdout('No Evaluators.');
    for (const evaluator of result.evaluators) output.stdout(describeEvaluator(evaluator));
    return 0;
  },
});

export const evalEvaluatorCreateCommand = defineCommand({
  name: 'mediforce eval evaluator-create',
  description: 'Create an Evaluator from a JSON file: { name, rule, severity, check }.',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with name, rule, severity and check' } },
  async run({ args, output, mediforce, jsonMode }) {
    const body = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.createEvaluator({ ...body, ...stepFrom(args) } as Parameters<typeof mediforce.evaluation.createEvaluator>[0]);
    if (jsonMode) printJson(output, result);
    else output.stdout(describeEvaluator(result.evaluator));
    return 0;
  },
});

export const evalEvaluatorVersionCommand = defineCommand({
  name: 'mediforce eval evaluator-version',
  description: 'Add a version to an Evaluator from a JSON file with any of { rule, severity, check }.',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    file: { type: 'string', required: true, description: 'JSON file with the changed fields' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const body = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.addEvaluatorVersion({ ...body, evaluatorId: args.evaluatorId });
    if (jsonMode) printJson(output, result);
    else output.stdout(describeEvaluator(result.evaluator));
    return 0;
  },
});

export const evalEvaluatorApproveCommand = defineCommand({
  name: 'mediforce eval evaluator-approve',
  description: 'Approve the source of a code Evaluator version, so it counts (a person\'s act; ADR-0023 D9).',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    version: { type: 'string', required: true, description: 'Version to approve' },
    uid: { type: 'string', description: 'Who approves (required with an API key)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const version = parsePositiveIntArg(args.version);
    if (version === undefined || version === 'invalid') {
      output.stderr('--version must be a positive integer');
      return 2;
    }
    const result = await mediforce.evaluation.approveEvaluatorSource({
      evaluatorId: args.evaluatorId,
      version,
      ...(args.uid !== undefined ? { uid: args.uid } : {}),
    });
    if (jsonMode) printJson(output, result);
    else output.stdout(describeEvaluator(result.evaluator));
    return 0;
  },
});

export const evalEvaluatorPreviewCommand = defineCommand({
  name: 'mediforce eval evaluator-preview',
  description: 'Run a draft check (JSON file) against the step\'s recent outputs. Writes nothing.',
  args: {
    ...STEP_ARGS,
    file: { type: 'string', required: true, description: 'JSON file with the check: { kind, ... }' },
    'agent-run': { type: 'string', description: 'Comma-separated Agent Run ids (default: recent production runs)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.previewEvaluator({
      ...stepFrom(args),
      check: readJsonFile(args.file) as Parameters<typeof mediforce.evaluation.previewEvaluator>[0]['check'],
      ...(args['agent-run'] !== undefined ? { agentRunIds: args['agent-run'].split(',') } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    for (const outcome of result.results) {
      const confidence = outcome.confidence === null ? '' : ` (confidence ${outcome.confidence.toFixed(2)})`;
      const verdict = outcome.error !== null ? `error: ${outcome.error}` : `${outcome.label ?? ''}${confidence} ${outcome.comment ?? ''}`;
      output.stdout(`${outcome.agentRunId}  ${verdict}`);
    }
    return 0;
  },
});

export const evalEvaluatorArchiveCommand = defineCommand({
  name: 'mediforce eval evaluator-archive',
  description: 'Archive an Evaluator (--restore brings it back).',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    restore: { type: 'boolean', description: 'Restore instead of archive' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.archiveEvaluator({ evaluatorId: args.evaluatorId, archived: args.restore !== true });
    if (jsonMode) printJson(output, result);
    else output.stdout(`${result.evaluator.name} ${result.evaluator.archived ? 'archived' : 'restored'}`);
    return 0;
  },
});

export const evalEvaluatorProductionCommand = defineCommand({
  name: 'mediforce eval evaluator-production',
  description: 'Set whether an Evaluator also scores live production runs of its step (--on / --off); it takes effect while it counts (ADR-0023 D13).',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    on: { type: 'boolean', description: 'Run it in production' },
    off: { type: 'boolean', description: 'Stop running it in production' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if ((args.on === true) === (args.off === true)) {
      output.stderr('Pass exactly one of --on or --off');
      return 2;
    }
    const result = await mediforce.evaluation.setEvaluatorProduction({ evaluatorId: args.evaluatorId, runInProduction: args.on === true });
    if (jsonMode) printJson(output, result);
    else output.stdout(describeEvaluator(result.evaluator));
    return 0;
  },
});

function describeMean(mean: number | null, count: number, window: number): string {
  return mean === null ? `${count}/${window} Scores` : mean.toFixed(2);
}

export const evalDriftCommand = defineCommand({
  name: 'mediforce eval drift',
  description: 'Print drift alerts for a step: per production Evaluator, the mean of its newest production Scores against the window before. An alert is a drop of at least the threshold.',
  args: {
    ...STEP_ARGS,
    window: { type: 'string', description: 'Production Scores per window, 2–500 (default: the deployment\'s, 20 unless set)' },
    threshold: { type: 'string', description: 'Drop in the mean Score that raises an alert, 0–1 (default: the deployment\'s, 0.15 unless set)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const window = parsePositiveIntArg(args.window);
    if (window === 'invalid') {
      output.stderr('--window must be a positive integer');
      return 2;
    }
    const threshold = args.threshold === undefined ? undefined : Number(args.threshold);
    if (threshold !== undefined && (Number.isFinite(threshold) === false || threshold <= 0 || threshold > 1)) {
      output.stderr('--threshold must be a number above 0 and at most 1');
      return 2;
    }
    const result = await mediforce.evaluation.getDrift({
      ...stepFrom(args),
      ...(window === undefined ? {} : { window }),
      ...(threshold === undefined ? {} : { threshold }),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`window ${result.window}, threshold ${result.threshold}`);
    if (result.evaluators.length === 0) output.stdout('No Evaluator scores this step\'s production runs.');
    for (const evaluator of result.evaluators) {
      output.stdout(`${evaluator.drifting ? 'ALERT' : 'ok   '}  ${evaluator.name} v${evaluator.evaluatorVersion} (${evaluator.severity})  `
        + `recent ${describeMean(evaluator.recentMean, evaluator.recentCount, result.window)}, `
        + `before ${describeMean(evaluator.baselineMean, evaluator.baselineCount, result.window)}`);
    }
    return 0;
  },
});
