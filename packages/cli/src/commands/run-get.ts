import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const HELP = `Usage: mediforce run get <runId> [options]

Fetch the current status of a single run.

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const runGetCommand = defineCommand({
  name: 'run get',
  help: HELP,
  options: {
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['runId'] as const,
  handler: async ({ positionals, mediforce, output, jsonMode, config }) => {
    const runId = positionals[0]!;
    const result = await mediforce.runs.get({ runId });
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
