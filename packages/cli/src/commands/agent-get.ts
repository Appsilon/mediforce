import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const HELP = `Usage: mediforce agent get <id> [options]

Fetch an agent definition by ID.

Positional:
  <id>                 Agent definition ID

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const agentGetCommand = defineCommand({
  name: 'agent get',
  help: HELP,
  options: {
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  positionals: ['<id>'] as const,
  handler: async ({ positionals, mediforce, output, jsonMode }) => {
    const id = positionals[0]!;
    const result = await mediforce.agents.get({ id });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const agent = result.agent;
    output.stdout(`Agent ${agent.id}`);
    output.stdout(`  name:          ${agent.name}`);
    output.stdout(`  kind:          ${agent.kind}`);
    output.stdout(`  model:         ${agent.foundationModel}`);
    output.stdout(`  description:   ${agent.description}`);
    if (agent.runtimeId !== undefined) {
      output.stdout(`  runtimeId:     ${agent.runtimeId}`);
    }
    if (agent.visibility !== undefined) {
      output.stdout(`  visibility:    ${agent.visibility}`);
    }
    if (agent.namespace !== undefined) {
      output.stdout(`  namespace:     ${agent.namespace}`);
    }
    if (agent.skillFileNames.length > 0) {
      output.stdout(`  skills:        ${agent.skillFileNames.join(', ')}`);
    }
    return 0;
  },
});
