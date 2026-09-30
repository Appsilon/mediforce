import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson } from '../output';
import { readJsonFile, STEP_ARGS, stepFrom } from './eval-step-args';
import type { EvaluatorView } from '@mediforce/platform-api/contract';

function describeEvaluator(evaluator: EvaluatorView): string {
  const trust = evaluator.trust.trusted ? 'counted' : `not counted (${evaluator.trust.reason})`;
  return `${evaluator.id}  ${evaluator.name.padEnd(24)} v${evaluator.latest.version}  ${evaluator.latest.check.kind.padEnd(9)} ${evaluator.latest.severity.padEnd(8)} ${trust}`;
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

export const evalEvaluatorLabelCommand = defineCommand({
  name: 'mediforce eval evaluator-label',
  description: 'Label one Agent Run\'s output pass or fail for an Evaluator — ground truth for judge calibration.',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    'agent-run': { type: 'string', required: true, description: 'Agent Run id' },
    pass: { type: 'boolean', description: 'The output passes' },
    fail: { type: 'boolean', description: 'The output fails' },
    comment: { type: 'string', description: 'Why' },
    uid: { type: 'string', description: 'Who labels (required with an API key)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if ((args.pass === true) === (args.fail === true)) {
      output.stderr('Pass exactly one of --pass or --fail');
      return 2;
    }
    const result = await mediforce.evaluation.labelOutput({
      evaluatorId: args.evaluatorId,
      agentRunId: args['agent-run'],
      passed: args.pass === true,
      ...(args.comment !== undefined ? { comment: args.comment } : {}),
      ...(args.uid !== undefined ? { uid: args.uid } : {}),
    });
    if (jsonMode) printJson(output, result);
    else output.stdout(`Labelled ${args['agent-run']} ${result.score.label}`);
    return 0;
  },
});

export const evalEvaluatorCalibrateCommand = defineCommand({
  name: 'mediforce eval evaluator-calibrate',
  description: 'Run an llm_judge over the labelled outputs and record its agreement with the labels.',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    version: { type: 'string', description: 'Version (default: latest)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const version = parsePositiveIntArg(args.version);
    if (version === 'invalid') {
      output.stderr('--version must be a positive integer');
      return 2;
    }
    const result = await mediforce.evaluation.calibrateEvaluator({
      evaluatorId: args.evaluatorId,
      ...(version !== undefined ? { version } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const calibration = result.evaluator.latest.calibration;
    output.stdout(describeEvaluator(result.evaluator));
    if (calibration !== null) {
      output.stdout(`agreement ${calibration.agreement.toFixed(2)} on ${calibration.labelCount} labels (${calibration.failureLabelCount} failures)`);
    }
    for (const miss of result.disagreements) output.stdout(`  disagrees on ${miss.agentRunId}: person ${miss.humanPassed ? 'pass' : 'fail'}, judge ${miss.judgePassed ? 'pass' : 'fail'}`);
    for (const failure of result.errors) output.stdout(`  could not grade ${failure.agentRunId}: ${failure.error}`);
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
      const verdict = outcome.error !== null ? `error: ${outcome.error}` : `${outcome.label ?? ''} ${outcome.comment ?? ''}`;
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
