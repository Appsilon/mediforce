import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const namespaceLeaveCommand = defineCommand({
  name: 'mediforce namespace leave',
  description: 'Leave a workspace (caller removes self). Owner cannot leave.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.namespaces.leave({ handle: args.handle });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Left namespace ${result.handle}`);
    return 0;
  },
});
