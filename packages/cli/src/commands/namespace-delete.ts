import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const namespaceDeleteCommand = defineCommand({
  name: 'mediforce namespace delete',
  description: 'Delete a workspace and cascade-remove all members. Owner only.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.namespaces.delete({ handle: args.handle });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Deleted namespace ${result.handle}`);
    return 0;
  },
});
