import { RED_TEAM_SUITES } from '@mediforce/platform-api/contract';
import { EvalCaseInputPartSchema } from '@mediforce/platform-core';
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
      output.stdout(`${evalCase.id}  ${evalCase.expectation.padEnd(8)} ${evalCase.split.padEnd(7)} ${evalCase.source.padEnd(10)} ${evalCase.name}`);
    }
    return 0;
  },
});

export const evalRunIoCommand = defineCommand({
  name: 'mediforce eval run-io',
  description: 'Show what an Agent Run\'s step was given and what it returned — the pair a case or a label is about.',
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
  description: 'Add a hand-written Eval Case from a JSON file: { name, input, expectation, notes?, split? }.',
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
  description: 'Add a production Agent Run to its step\'s eval set — approved runs are positive, rejected ones negative.',
  args: {
    agentRunId: { type: 'positional', required: true, description: 'Agent Run id' },
    name: { type: 'string', description: 'Case name' },
    expectation: enumArg(['positive', 'negative'] as const, { description: 'Required when the run was never reviewed' }),
    split: enumArg(['dev', 'holdout'] as const, { description: 'Default: dev' }),
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.createCaseFromAgentRun({
      agentRunId: args.agentRunId,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.expectation !== undefined ? { expectation: args.expectation } : {}),
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
    + '{ name, baseAgentRunId, perturbation: { kind, description }, inputChanges?, fileChanges?, expectation, notes, split? }.',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with the case' } },
  async run({ args, output, mediforce, jsonMode }) {
    const body = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.createPerturbedCase({ ...body, ...stepFrom(args) } as Parameters<typeof mediforce.evaluation.createPerturbedCase>[0]);
    if (jsonMode) printJson(output, result);
    else output.stdout(`Eval Case ${result.evalCase.id} added (${result.evalCase.perturbation?.kind}, ${result.evalCase.expectation})`);
    return 0;
  },
});

export const evalCaseRedTeamCommand = defineCommand({
  name: 'mediforce eval case-red-team',
  description: 'Add a red-team or robustness suite of Eval Cases from a production run: prompt_injection appends injected '
    + 'instructions to the text at --target, robustness rewrites it without changing its meaning. Grade them with '
    + 'builtin Evaluators injection_ignored and result_stable.',
  args: {
    ...STEP_ARGS,
    run: { type: 'string', required: true, description: 'Production Agent Run id the cases are built from' },
    suite: enumArg(RED_TEAM_SUITES, { required: true, description: 'prompt_injection or robustness' }),
    target: { type: 'string', required: true, description: 'Input value to change, as part.path.to.value — part is triggerPayload, previousStepOutputs or previousRun' },
    split: enumArg(['dev', 'holdout'] as const, { description: 'Default: dev' }),
  },
  async run({ args, output, mediforce, jsonMode }) {
    const [rawPart, ...path] = args.target.split('.');
    const part = EvalCaseInputPartSchema.safeParse(rawPart);
    if (part.success === false) {
      output.stderr(`--target must start with ${EvalCaseInputPartSchema.options.join(', ')}, got '${rawPart}'`);
      return 1;
    }
    const result = await mediforce.evaluation.createRedTeamCases({
      ...stepFrom(args),
      baseAgentRunId: args.run,
      // `required: true` on the enumArg — citty enforces at parse time.
      suite: args.suite!,
      target: { part: part.data, path },
      ...(args.split !== undefined ? { split: args.split } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`${result.cases.length} Eval Case(s) added`);
    for (const evalCase of result.cases) output.stdout(`  ${evalCase.id}  ${evalCase.name}`);
    return 0;
  },
});

export const evalCasesFromLabelsCommand = defineCommand({
  name: 'mediforce eval cases-from-labels',
  description: 'Turn an Evaluator\'s labelled outputs into Eval Cases — a pass positive, a fail negative.',
  args: {
    evaluatorId: { type: 'positional', required: true, description: 'Evaluator id' },
    split: enumArg(['dev', 'holdout'] as const, { description: 'Default: dev' }),
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.createCasesFromLabels({
      evaluatorId: args.evaluatorId,
      ...(args.split !== undefined ? { split: args.split } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`${result.cases.length} Eval Case(s) added`);
    for (const evalCase of result.cases) output.stdout(`  ${evalCase.id}  ${evalCase.expectation.padEnd(8)} from ${evalCase.sourceAgentRunId}`);
    for (const skipped of result.skipped) output.stdout(`  skipped ${skipped.agentRunId}: ${skipped.reason}`);
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
  description: 'Edit an Eval Case from a JSON file of the fields to change: { name?, input?, expectation?, notes?, split? }. '
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

export const evalWrittenOutputListCommand = defineCommand({
  name: 'mediforce eval written-output-list',
  description: 'List a step\'s written outputs — a person\'s examples of its output, labelled to calibrate a judge.',
  args: { ...STEP_ARGS, 'include-archived': { type: 'boolean', description: 'Include archived ones' } },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.listWrittenOutputs({ ...stepFrom(args), includeArchived: args['include-archived'] === true ? 'true' : undefined });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.writtenOutputs.length === 0) output.stdout('No written outputs.');
    for (const written of result.writtenOutputs) {
      output.stdout(`${written.id}  ${written.basedOnAgentRunId === null ? 'written from nothing' : `from ${written.basedOnAgentRunId}`}${written.archived ? '  archived' : ''}  ${written.note ?? ''}`);
    }
    return 0;
  },
});

export const evalWrittenOutputAddCommand = defineCommand({
  name: 'mediforce eval written-output-add',
  description: 'Add a written output from a JSON file: { result, basedOnAgentRunId?, stepInput?, note?, label?: { evaluatorId, passed, comment? }, uid? }. '
    + 'Started from a production run, it takes that run\'s input.',
  args: { ...STEP_ARGS, file: { type: 'string', required: true, description: 'JSON file with the written output' } },
  async run({ args, output, mediforce, jsonMode }) {
    const body = readJsonFile(args.file) as Record<string, unknown>;
    const result = await mediforce.evaluation.createWrittenOutput({ ...body, ...stepFrom(args) } as Parameters<typeof mediforce.evaluation.createWrittenOutput>[0]);
    if (jsonMode) printJson(output, result);
    else output.stdout(`Written output ${result.writtenOutput.id} added${result.score === null ? '' : `, labelled ${result.score.label}`}`);
    return 0;
  },
});

export const evalWrittenOutputArchiveCommand = defineCommand({
  name: 'mediforce eval written-output-archive',
  description: 'Archive a written output (--restore brings it back); an archived one leaves every judge\'s labels.',
  args: {
    writtenOutputId: { type: 'positional', required: true, description: 'Written output id' },
    restore: { type: 'boolean', description: 'Restore instead of archive' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.evaluation.archiveWrittenOutput({ writtenOutputId: args.writtenOutputId, archived: args.restore !== true });
    if (jsonMode) printJson(output, result);
    else output.stdout(`Written output ${result.writtenOutput.id} ${result.writtenOutput.archived ? 'archived' : 'restored'}`);
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
