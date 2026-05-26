import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce workflow set-visibility <name> --visibility <public|private> [options]

Set the visibility of a workflow definition.

Positional:
  <name>               Workflow definition name

Required flags:
  --visibility <v>     Visibility level (public | private)

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const workflowSetVisibilityCommand = defineCommand({
  name: 'workflow set-visibility',
  help: HELP,
  options: {
    visibility: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<name>'] as const,
  handler: async ({ flags, positionals, mediforce, output, jsonMode }) => {
    const name = positionals[0]!;

    if (flags.visibility !== 'public' && flags.visibility !== 'private') {
      printError(output, { error: '--visibility must be "public" or "private"' }, jsonMode);
      return 2;
    }
    const visibility = flags.visibility;

    const result = await mediforce.workflows.setVisibility({ name, visibility });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Set ${result.name} visibility to ${result.visibility}`);
    }
    return 0;
  },
});
