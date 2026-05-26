import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

const HELP = `Usage: mediforce agent list [options]

List all agent definitions.

Optional flags:
  --base-url <url>     API base URL (default: http://localhost:9003)
  --json               Emit JSON instead of human-readable output
  --help, -h           Show this help text
`;

export const agentListCommand = defineCommand({
  name: 'agent list',
  help: HELP,
  options: {
    'base-url': { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } as const,
  handler: async ({ mediforce, output, jsonMode }) => {
    const result = await mediforce.agents.list();
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.agents.length === 0) {
      output.stdout('No agent definitions found.');
      return 0;
    }
    output.stdout(`Found ${String(result.agents.length)} agent(s):`);
    for (const agent of result.agents) {
      output.stdout(`  ${agent.id}  ${agent.name}  (${agent.foundationModel})  [${agent.visibility}]  ns=${agent.namespace ?? '—'}`);
    }
    return 0;
  },
});
