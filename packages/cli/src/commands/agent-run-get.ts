import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const agentRunGetCommand = defineCommand({
  name: 'mediforce agent-run get',
  description: 'Fetch a single agent run by id.',
  args: {
    agentRunId: { type: 'positional', required: true, description: 'Agent run id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.agentRuns.get({ agentRunId: args.agentRunId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const run = result.run;
    output.stdout(`Agent run ${run.id}`);
    printKv(output, [
      ['status', run.status],
      ['plugin', run.pluginId],
      ['autonomy', run.autonomyLevel],
      ['instance', run.processInstanceId],
      ['step', run.stepId],
      ['started', run.startedAt],
      ['completed', run.completedAt ?? undefined],
      ['fallback', run.fallbackReason ?? undefined],
    ]);
    return 0;
  },
});
