import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const coworkGetByInstanceCommand = defineCommand({
  name: 'mediforce cowork get-by-instance',
  description: 'Fetch the active cowork session for a process instance.',
  args: {
    instanceId: { type: 'positional', required: true, description: 'Process instance id' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const session = await mediforce.cowork.getByInstance({ instanceId: args.instanceId });
    if (jsonMode) {
      printJson(output, session);
      return 0;
    }
    output.stdout(`Cowork session ${session.id}`);
    printKv(output, [
      ['status', session.status],
      ['agent', session.agent],
      ['step', session.stepId],
      ['turns', String(session.turns.length)],
    ]);
    return 0;
  },
});
