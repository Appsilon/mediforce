import { defineCommand } from '../define-command.js';
import { printJson } from '../output.js';

export const userListCommand = defineCommand({
  name: 'mediforce user list',
  description: 'List workspace members with role and last sign-in metadata.',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.listMembers({ namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.members.length === 0) {
      output.stdout(`No members in namespace "${args.namespace}".`);
      return 0;
    }
    for (const m of result.members) {
      const email = m.email ?? '(no email)';
      const display = m.displayName ?? '(no display name)';
      const lastSignIn = m.lastSignInTime ?? 'never';
      output.stdout(`${m.role.padEnd(8)} ${email.padEnd(32)} ${display}  (last sign-in: ${lastSignIn})`);
    }
    return 0;
  },
});
