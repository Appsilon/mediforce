import { defineCommand, enumArg } from '../define-command';
import { printJson } from '../output';
import { readJsonFile, STEP_ARGS, stepFrom } from './eval-step-args';

export const evalCaseListCommand = defineCommand({
  name: 'mediforce eval case-list',
  description: 'List a step\'s Eval Cases, newest first.',
  args: { ...STEP_ARGS, 'include-archived': { type: 'boolean', description: 'Include archived cases' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listCases({ ...stepFrom(args), includeArchived: args['include-archived'] === true ? 'true' : undefined });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.cases.length === 0) output.stdout('No Eval Cases.');
    for (const evalCase of result.cases) {
      const compared = evalCase.expectedOutput === null ? 'no expected output' : `${evalCase.comparison} ${evalCase.expectation}`;
      output.stdout(`${evalCase.id}  ${compared.padEnd(18)} ${evalCase.split.padEnd(7)} ${evalCase.source.padEnd(10)} ${evalCase.name}`);
    }
    return 0;
  },
});

export const evalRunIoCommand = defineCommand({
  name: 'mediforce eval run-io',
  description: 'Show what an Agent Run\'s step was given and what it returned — the pair a case is about.',
  args: { agentRunId: { type: 'positional', required: true, description: 'Agent Run id' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getAgentRunIo({ agentRunId: args.agentRunId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Agent Run ${result.agentRunId} (${result.status})`);
    output.stdout(`Input:\n${JSON.stringify(result.stepInput, null, 2)}`);
    output.stdout(`Output:\n${JSON.stringify(result.result, null, 2)}`);
    return 0;
  },
});

export const evalCaseAddCommand = defineCommand({
  name: 'mediforce eval case-add',
  description: 'Add a hand-written Eval Case from a JSON file: { name, input, expectedOutput?, expectation?, comparison?, agreementInstructions?, evaluatorIds?, split? } '
    + '(expectation defaults to positive, comparison to exact, evaluatorIds to every Evaluator of the step).',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with the case' } },
  async run({ args, output, mediforce, jsonMode }) {
    const body = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.createCase({ ...body, ...stepFrom(args) } as Parameters<typeof mediforce.evaluation.createCase>[0]);
    if (jsonMode) printJson(output, result);
    else output.stdout(`Eval Case ${result.evalCase.id} added`);
    return 0;
  },
});

export const evalCaseFromRunCommand = defineCommand({
  name: 'mediforce eval case-from-run',
  description: 'Add a production Agent Run to its step\'s eval set — a reviewed run\'s output is the expected output: approved to match, rejected to avoid.',
  args: {
    agentRunId: { type: 'positional', required: true, description: 'Agent Run id' },
    name: { type: 'string', description: 'Case name' },
    expectation: enumArg(['positive', 'negative'] as const, { description: 'Default: from the review verdict, positive when there is none' }),
    comparison: enumArg(['exact', 'agreement'] as const, { description: 'How the expected output is compared. Default: exact' }),
    split: enumArg(['dev', 'holdout'] as const, { description: 'Default: dev' }),
    inputFile: { type: 'string', description: 'JSON file with the case input to use instead of the run\'s; one that differs makes a manual case that keeps the run' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.createCaseFromAgentRun({
      agentRunId: args.agentRunId,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.inputFile !== undefined ? { input: readJsonFile(args.inputFile) as Parameters<typeof mediforce.evaluation.createCaseFromAgentRun>[0]['input'] } : {}),
      ...(args.expectation !== undefined ? { expectation: args.expectation } : {}),
      ...(args.comparison !== undefined ? { comparison: args.comparison } : {}),
      ...(args.split !== undefined ? { split: args.split } : {}),
    });
    if (jsonMode) printJson(output, result);
    else output.stdout(`Eval Case ${result.evalCase.id} added (${result.evalCase.expectation}, ${result.evalCase.split})`);
    return 0;
  },
});

export const evalCasePerturbCommand = defineCommand({
  name: 'mediforce eval case-perturb',
  description: 'Synthesize an Eval Case from a production run with deliberate changes, from a JSON file: '
    + '{ name, baseAgentRunId, perturbation: { kind, description }, inputChanges?, fileChanges?, expectedOutput?, expectation?, comparison?, agreementInstructions?, evaluatorIds?, split? } (expectation defaults to positive).',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with the case' } },
  async run({ args, output, mediforce, jsonMode }) {
    const body = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.createPerturbedCase({ ...body, ...stepFrom(args) } as Parameters<typeof mediforce.evaluation.createPerturbedCase>[0]);
    if (jsonMode) printJson(output, result);
    else output.stdout(`Eval Case ${result.evalCase.id} added (${result.evalCase.perturbation?.kind}, ${result.evalCase.expectation})`);
    return 0;
  },
});

export const evalCaseArchiveCommand = defineCommand({
  name: 'mediforce eval case-archive',
  description: 'Archive an Eval Case (--restore brings it back).',
  args: {
    caseId: { type: 'positional', required: true, description: 'Eval Case id' },
    restore: { type: 'boolean', description: 'Restore instead of archive' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.archiveCase({ caseId: args.caseId, archived: args.restore !== true });
    if (jsonMode) printJson(output, result);
    else output.stdout(`${result.evalCase.name} ${result.evalCase.archived ? 'archived' : 'restored'}`);
    return 0;
  },
});

export const evalCaseEditCommand = defineCommand({
  name: 'mediforce eval case-edit',
  description: 'Edit an Eval Case from a JSON file of the fields to change: { name?, input?, expectedOutput?, expectation?, comparison?, agreementInstructions?, evaluatorIds?, split? }. '
    + 'The edit is a new case that replaces it; the old one is archived, so frozen Dataset versions keep it.',
  args: {
    caseId: { type: 'positional', required: true, description: 'Eval Case id' },
    file: { type: 'string', required: true, description: 'JSON file with the changes' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const changes = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.updateCase({ ...changes, caseId: args.caseId } as Parameters<typeof mediforce.evaluation.updateCase>[0]);
    if (jsonMode) printJson(output, result);
    else output.stdout(`Eval Case ${result.evalCase.id} replaces ${args.caseId}`);
    return 0;
  },
});

export const evalDatasetListCommand = defineCommand({
  name: 'mediforce eval dataset-list',
  description: 'List a step\'s frozen Eval Dataset versions.',
  args: { ...STEP_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listDatasets(stepFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.datasets.length === 0) output.stdout('No Eval Dataset versions.');
    for (const dataset of result.datasets) {
      output.stdout(`v${dataset.version}  ${dataset.id}  ${dataset.caseIds.length} case(s)${dataset.containsProductionData ? '  contains production data' : ''}`);
    }
    return 0;
  },
});

export const evalDatasetFreezeCommand = defineCommand({
  name: 'mediforce eval dataset-freeze',
  description: 'Freeze the step\'s live Eval Cases (or --cases) as a new Dataset version.',
  args: { ...STEP_ARGS, cases: { type: 'string', description: 'Comma-separated case ids (default: all live cases)' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.freezeDataset({
      ...stepFrom(args),
      ...(args.cases !== undefined ? { caseIds: args.cases.split(',') } : {}),
    });
    if (jsonMode) printJson(output, result);
    else output.stdout(`Eval Dataset v${result.dataset.version} frozen with ${result.dataset.caseIds.length} case(s)`);
    return 0;
  },
});

export const evalMcpPolicyGetCommand = defineCommand({
  name: 'mediforce eval mcp-policy-get',
  description: 'Show what each of the step agent\'s MCP servers may do in an eval trial.',
  args: { ...STEP_ARGS },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.getMcpPolicy(stepFrom(args));
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.servers.length === 0) output.stdout('The step\'s agent binds no MCP servers.');
    for (const server of result.servers) {
      const denied = server.denyTools !== undefined && server.denyTools.length > 0 ? ` (denied: ${server.denyTools.join(', ')})` : '';
      const recorded = `  recorded for ${server.recordedCaseIds.length} case(s)`;
      output.stdout(`${server.name.padEnd(20)} ${server.mode}${denied}${server.defaulted ? '  [default]' : ''}${recorded}`);
    }
    return 0;
  },
});

export const evalMcpPolicySetCommand = defineCommand({
  name: 'mediforce eval mcp-policy-set',
  description: 'Replace the step\'s MCP eval policy from a JSON file: { "<server>": { "mode": "live"|"replay"|"deny", "denyTools"?: [] } }. A live trial records each server\'s responses per case; replay answers from them, and runs a case with no recording yet live to record it.',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with the servers map' } },
  async run({ args, output, mediforce, jsonMode }) {
    const servers = readJsonFile(args.file) as Parameters<typeof mediforce.evaluation.setMcpPolicy>[0]['servers'];
    const result = await mediforce.evaluation.setMcpPolicy({ ...stepFrom(args), servers });
    if (jsonMode) printJson(output, result);
    else output.stdout(`MCP eval policy set for ${Object.keys(result.policy.servers).length} server(s)`);
    return 0;
  },
});
