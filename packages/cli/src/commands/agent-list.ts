import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const agentListCommand = defineCommand({
  name: 'mediforce agent list',
  description: 'List all agent definitions.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
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
      output.stdout(
        `  ${agent.id}  ${agent.name}  (${agent.foundationModel})  [${agent.visibility}]  ns=${agent.namespace ?? '—'}`,
      );
    }
    return 0;
  },
});
