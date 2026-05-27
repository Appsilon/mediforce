import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

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
    output.stdout(`Run ${result.runId}`);
    output.stdout(`  status:        ${result.status}`);
    output.stdout(`  currentStep:   ${result.currentStepId ?? '(none)'}`);
    output.stdout(`  error:         ${result.error ?? '(none)'}`);
    if (
      typeof result.definitionNamespace === 'string' &&
      result.definitionNamespace.length > 0 &&
      typeof result.definitionName === 'string' &&
      result.definitionName.length > 0
    ) {
      output.stdout(
        `  url:           ${config.baseUrl}/${result.definitionNamespace}/workflows/${encodeURIComponent(result.definitionName)}/runs/${result.runId}`,
      );
    }
    if (result.totalCostUsd != null) {
      const isTerminal = result.status === 'completed' || result.status === 'failed';
      output.stdout(`  cost:          $${result.totalCostUsd.toFixed(4)}${isTerminal ? '' : '+'}`);
    }
    if (result.finalOutput !== null && result.finalOutput !== undefined) {
      output.stdout(`  finalOutput:   ${JSON.stringify(result.finalOutput)}`);
    }
    return 0;
  },
});
