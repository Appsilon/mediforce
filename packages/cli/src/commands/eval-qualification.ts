import { DEFAULT_ACCEPTANCE_CRITERIA, describeAcceptanceCriteria as describeCriteria, describeMcpPolicy, type AcceptanceCriteria } from '@mediforce/platform-core';
import type { GetStepQualificationOutput, StepValidation } from '@mediforce/platform-api/contract';
import { defineCommand, parsePositiveIntArg } from '../define-command';
import { printJson } from '../output';
import { readJsonFile, STEP_ARGS, stepFrom } from './eval-step-args';

const QUALIFICATION_LABEL: Record<GetStepQualificationOutput['status'], string> = { qualified: 'qualified', stale: 'stale', not_qualified: 'not qualified' };
const STEP_VALIDATION_LABEL: Record<StepValidation['status'], string> = { passed: 'passed', failed: 'failed', not_verified: 'not verified' };
const VERSION_VALIDATION_LABEL: Record<StepValidation['status'], string> = { passed: 'verified', failed: 'failed', not_verified: 'not verified' };

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
      ? `Not set — the default applies: ${describeCriteria(DEFAULT_ACCEPTANCE_CRITERIA)}`
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
    output.stdout(`validation ${STEP_VALIDATION_LABEL[result.validation.status]}: ${result.validation.reason}${result.validation.runInProgress ? ' (an Eval Run is running)' : ''}`);
    output.stdout(`${QUALIFICATION_LABEL[result.status]}  (v${result.definitionVersion}, fingerprint ${result.fingerprint.hash.slice(0, 12)})`);
    const { qualification } = result;
    if (qualification === null) return 0;
    output.stdout(`signed by ${qualification.signature.signerName} at ${qualification.signature.signedAt} for '${qualification.variantLabel}' of Eval Run ${qualification.evalRunId}`);
    output.stdout(`criteria: ${describeCriteria(qualification.acceptanceCriteria)}`);
    output.stdout(describeMcpPolicy(qualification.mcpPolicy));
    for (const deviation of qualification.deviations) output.stdout(`deviation (${deviation.severity}): ${deviation.justification}`);
    if (result.changed.length > 0) output.stdout(`changed since: ${result.changed.join(', ')}`);
    for (const change of result.evaluatorsChanged) output.stdout(`evaluators changed: ${change}`);
    return 0;
  },
});

export const evalValidationCommand = defineCommand({
  name: 'mediforce eval validation',
  description: 'Print whether each live version of a workflow is verified — every agent step passed its Acceptance Criteria in it — with each step\'s validation.',
  args: {
    namespace: { type: 'string', required: true, description: 'Workspace handle' },
    workflow: { type: 'string', required: true, description: 'Workflow name' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getWorkflowValidation({ namespace: args.namespace, workflowName: args.workflow });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    for (const version of result.versions) {
      output.stdout(`v${version.definitionVersion}  ${VERSION_VALIDATION_LABEL[version.status]}`);
      for (const step of version.steps) output.stdout(`  ${step.stepId}  ${STEP_VALIDATION_LABEL[step.validation.status]}: ${step.validation.reason}`);
    }
    return 0;
  },
});
