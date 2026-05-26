import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const HELP = `Usage: mediforce workflow list [options]

List every registered workflow definition (latest version per name).

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const workflowListCommand = defineCommand({
  name: 'workflow list',
  help: HELP,
  options: {
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ mediforce, output, jsonMode }) => {
    const result = await mediforce.workflows.list();
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.definitions.length === 0) {
      output.stdout('No workflow definitions registered.');
      return 0;
    }
    output.stdout(`Found ${String(result.definitions.length)} workflow(s):`);
    for (const group of result.definitions) {
      const defaultLabel =
        group.defaultVersion === null
          ? 'no default'
          : `default: v${String(group.defaultVersion)}`;
      const visibility = group.definition?.visibility ?? 'private';
      output.stdout(
        `  ${group.name}  latest: v${String(group.latestVersion)}  (${defaultLabel})  [${visibility}]`,
      );
    }
    return 0;
  },
});
