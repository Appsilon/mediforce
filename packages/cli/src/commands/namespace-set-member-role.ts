import { defineCommand } from '../define-command.js';
import { printJson, printKv } from '../output.js';

export const namespaceSetMemberRoleCommand = defineCommand({
  name: 'mediforce namespace set-member-role',
  description: 'Flip a member to admin or member. Owner only.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
    uid: { type: 'string', required: true, description: 'Target member uid' },
    role: { type: 'string', required: true, description: 'admin | member' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if (args.role !== 'admin' && args.role !== 'member') {
      output.stderr(`Invalid role '${args.role}' — expected 'admin' or 'member'`);
      return 2;
    }
    const result = await mediforce.namespaces.updateMemberRole({
      handle: args.handle,
      uid: args.uid,
      role: args.role,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Updated ${result.member.uid} in ${args.handle}`);
    printKv(output, [['role', result.member.role]]);
    return 0;
  },
});
