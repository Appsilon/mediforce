import { defineCommand, enumArg } from '../define-command';
import { printJson, printKv } from '../output';

/**
 * The CLI half of the admin invite path, which had none until ADR-0021 shipped
 * its join-link sibling (AGENTS.md §4: an operation the platform performs must
 * be reachable from `mediforce`). Route-adapter-thin over the existing
 * `inviteUser` handler — no logic lives here.
 *
 * Seeds the account and sends the activation email. For a roster you already
 * have, this is still the right tool; `namespace create-join-link` is for the
 * room whose roster you do not.
 */
export const usersInviteCommand = defineCommand({
  name: 'mediforce users invite',
  description: 'Invite someone to a workspace by email (seeds the account, sends the activation link).',
  args: {
    handle: { type: 'positional', required: true, description: 'Workspace handle' },
    email: { type: 'positional', required: true, description: 'Invitee email address' },
    role: enumArg(['member', 'admin'] as const, {
      description: 'Workspace membership to grant (default: member)',
    }),
    name: { type: 'string', description: 'Display name for the invitee' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.invite({
      email: args.email,
      namespaceHandle: args.handle,
      role: args.role ?? 'member',
      ...(typeof args.name === 'string' && args.name !== '' ? { displayName: args.name } : {}),
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(
      result.isExisting
        ? `${result.email} added to ${args.handle}`
        : `Invited ${result.email} to ${args.handle}`,
    );
    printKv(output, [
      ['uid', result.uid],
      ['email sent', result.emailSent ? 'yes' : 'no — tell them to sign in'],
    ]);
    return 0;
  },
});
