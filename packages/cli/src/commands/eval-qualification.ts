import { describeAcceptanceCriteria as describeCriteria, type AcceptanceCriteria } from '@mediforce/platform-core';
import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson } from '../output';
import { readJsonFile, STEP_ARGS, stepFrom } from './eval-step-args';

export const evalCriteriaGetCommand = defineCommand({
  name: 'mediforce eval criteria-get',
  description: 'Print a step\'s Acceptance Criteria — the floors the next Eval Run is judged against.',
  args: { ...STEP_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getAcceptanceCriteria(stepFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(result.criteria === null
      ? 'No Acceptance Criteria yet.'
      : `v${result.criteria.version} (${result.criteria.origin})  ${describeCriteria(result.criteria.criteria)}`);
    return 0;
  },
});

export const evalCriteriaSetCommand = defineCommand({
  name: 'mediforce eval criteria-set',
  description: 'Set a step\'s Acceptance Criteria from a JSON file: { "critical": { "minPassRate": 0.95, "minPassHatK": 0.9 }, "major": { "minPassRate": 0.8 } }.',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with the criteria per severity' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.setAcceptanceCriteria({
      ...stepFrom(args),
      criteria: readJsonFile(args.file) as AcceptanceCriteria,
    });
    if (jsonMode) printJson(output, result);
    else output.stdout(`Acceptance Criteria v${result.criteria.version} written: ${describeCriteria(result.criteria.criteria)}`);
    return 0;
  },
});

export const evalQualificationCommand = defineCommand({
  name: 'mediforce eval qualification',
  description: 'Print a step\'s qualification: Qualified, Stale (and what changed) or Not qualified. A person signs one in the Evaluation tab.',
  args: { ...STEP_ARGS, version: { type: 'string', description: 'Definition version (default: the runnable one)' } },
  async run({ args, output, mediforce, jsonMode }) {
    const version = parsePositiveIntArg(args.version);
    if (version === 'invalid') {
      output.stderr('--version must be a positive integer');
      return 2;
    }
    const result = await mediforce.evaluation.getQualification({
      ...stepFrom(args),
      ...(version === undefined ? {} : { definitionVersion: version }),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`${result.status.replace('_', ' ')}  (v${result.definitionVersion}, fingerprint ${result.fingerprint.hash.slice(0, 12)})`);
    const { qualification } = result;
    if (qualification === null) return 0;
    output.stdout(`signed by ${qualification.signature.signerName} at ${qualification.signature.signedAt} for '${qualification.variantLabel}' of Eval Run ${qualification.evalRunId}, Brief v${qualification.briefVersion}`);
    output.stdout(`criteria: ${describeCriteria(qualification.acceptanceCriteria)}`);
    for (const deviation of qualification.deviations) output.stdout(`deviation (${deviation.severity}): ${deviation.justification}`);
    if (result.changed.length > 0) output.stdout(`changed since: ${result.changed.join(', ')}`);
    for (const change of result.evaluatorsChanged) output.stdout(`evaluators changed: ${change}`);
    return 0;
  },
});
