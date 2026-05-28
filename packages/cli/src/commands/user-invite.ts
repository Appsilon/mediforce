import { defineCommand, enumArg } from '../define-command.js';
import { printJson } from '../output.js';

export const userInviteCommand = defineCommand({
  name: 'mediforce user invite',
  description:
    'Invite a user to a workspace. Returns a temporary password the invitee must rotate on first sign-in.',
  args: {
    email: { type: 'string', required: true, description: 'Invitee email' },
    namespace: {
      type: 'string',
      required: true,
      description: 'Target namespace handle (lowercase alphanumeric + hyphens)',
    },
    role: enumArg(['member', 'admin'] as const, {
      description: 'Role to grant (default: member)',
    }),
    'display-name': { type: 'string', description: 'Optional display name for the new user' },
    'inviter-name': { type: 'string', description: 'Optional name to attribute the invite to' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.invite({
      email: args.email,
      namespaceHandle: args.namespace,
      ...(args.role !== undefined ? { role: args.role } : {}),
      ...(args['display-name'] !== undefined ? { displayName: args['display-name'] } : {}),
      ...(args['inviter-name'] !== undefined ? { inviterName: args['inviter-name'] } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`User invited: ${result.email} (uid: ${result.uid})`);
    output.stdout(`  existing user:      ${String(result.isExisting)}`);
    output.stdout(`  invitation email:   ${result.emailSent ? 'sent' : 'NOT sent'}`);
    output.stdout(`  temporary password: ${result.temporaryPassword}`);
    output.stdout('  (the invitee must rotate this password on first sign-in)');
    return 0;
  },
});
