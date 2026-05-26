import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce agent set-visibility <id> --visibility <public|private> [options]

Set the visibility of an agent definition.

Positional:
  <id>                 Agent definition ID

Required flags:
  --visibility <v>     Visibility level (public | private)

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const agentSetVisibilityCommand = defineCommand({
  name: 'agent set-visibility',
  help: HELP,
  options: {
    visibility: { type: 'string' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<id>'] as const,
  handler: async ({ flags, positionals, mediforce, output, jsonMode }) => {
    const id = positionals[0]!;
    if (flags.visibility !== 'public' && flags.visibility !== 'private') {
      printError(output, { error: '--visibility must be "public" or "private"' }, jsonMode);
      return 2;
    }
    const visibility = flags.visibility;
    const result = await mediforce.agents.update({ id }, { visibility });
    if (jsonMode) {
      printJson(output, result);
    } else {
      output.stdout(`Set agent ${id} visibility to ${visibility}`);
    }
    return 0;
  },
});
