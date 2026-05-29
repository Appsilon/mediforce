import { defineCommand } from '../define-command';
import { printJson } from '../output';

export const namespaceRemoveMemberCommand = defineCommand({
  name: 'mediforce namespace remove-member',
  description: 'Remove a member from a workspace. Owner/admin only.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
    uid: { type: 'string', required: true, description: 'Target member uid' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.namespaces.removeMember({ handle: args.handle, uid: args.uid });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Removed ${result.uid} from ${result.handle}`);
    return 0;
  },
});
