import { defineCommand } from '../define-command.js';
import { printJson, printError } from '../output.js';

const HELP = `Usage: mediforce agent delete <id> [options]

Delete an agent definition by ID.

Positional:
  <id>                 Agent definition ID

Required flags:
  --force              Confirm deletion (required)

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const agentDeleteCommand = defineCommand({
  name: 'agent delete',
  help: HELP,
  options: {
    force: { type: 'boolean' },
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<id>'] as const,
  handler: async ({ flags, positionals, mediforce, output, jsonMode }) => {
    const id = positionals[0]!;
    if (flags.force !== true) {
      const { agent } = await mediforce.agents.get({ id });
      output.stderr(`About to delete agent ${agent.id}:`);
      output.stderr(`  name:    ${agent.name}`);
      output.stderr(`  model:   ${agent.foundationModel}`);
      if (agent.namespace !== undefined) {
        output.stderr(`  ns:      ${agent.namespace}`);
      }
      output.stderr('');
      printError(output, { error: 'Pass --force to confirm deletion' }, jsonMode);
      return 1;
    }
    const result = await mediforce.agents.delete({ id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Deleted agent ${id}`);
    return 0;
  },
});
