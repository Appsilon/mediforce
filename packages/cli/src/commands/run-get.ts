import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

export const runGetCommand = defineCommand({
  name: 'mediforce run get',
  description: 'Fetch the current status of a single run.',
  args: {
    runId: {
      type: 'positional',
      required: true,
      description: 'Run identifier',
    },
  },
  async run({ args, output, config, mediforce, jsonMode }) {
    const result = await mediforce.runs.get({ runId: args.runId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const hasDefinition =
      typeof result.definitionNamespace === 'string' &&
      result.definitionNamespace.length > 0 &&
      typeof result.definitionName === 'string' &&
      result.definitionName.length > 0;
    const url = hasDefinition
      ? `${config.baseUrl}/${result.definitionNamespace ?? ''}/workflows/${encodeURIComponent(result.definitionName ?? '')}/runs/${result.runId}`
      : undefined;
    const cost =
      result.totalCostUsd != null
        ? `$${result.totalCostUsd.toFixed(4)}${result.status === 'completed' || result.status === 'failed' ? '' : '+'}`
        : undefined;
    const finalOutput =
      result.finalOutput !== null && result.finalOutput !== undefined
        ? JSON.stringify(result.finalOutput)
        : undefined;
    output.stdout(`Run ${result.runId}`);
    printKv(output, [
      ['status', result.status],
      ['currentStep', result.currentStepId],
      ['error', result.error],
      ['url', url],
      ['cost', cost],
      ['finalOutput', finalOutput],
    ]);
    return 0;
  },
});
