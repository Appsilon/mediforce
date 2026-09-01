import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

/**
 * Roles, not Membership — the plural in the command name is the whole
 * distinction, and it is the same one `CONTEXT.md` draws. `set-member-role`
 * (singular) moves someone between owner / admin / member: who administers
 * the workspace. This one sets `reviewer`, `PI`, `approver`: what they do in
 * a process. The description text says so at the terminal, where the two sit
 * one line apart in `--help`.
 */
export const namespaceSetMemberRolesCommand = defineCommand({
  name: 'mediforce namespace set-member-roles',
  description:
    'Set a member\'s process roles (reviewer, PI, …). Owner/admin only. Not to be confused with set-member-role (singular), which is workspace membership: owner|admin|member.',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
    uid: { type: 'string', required: true, description: 'Target member uid' },
    roles: {
      type: 'string',
      required: true,
      description: 'Comma-separated role names, or "" to clear every role',
    },
    workflow: {
      type: 'string',
      description: 'Narrow the grants to one workflow. Omit to grant across every workflow in the workspace.',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const workflowName = args.workflow ?? null;
    // A full replace has to be able to express "no roles", and citty gives a
    // missing `--roles` and an empty one the same shape without `required`.
    // Requiring the flag and reading `--roles ""` as the empty set keeps
    // clearing explicit rather than accidental.
    const roles = [...new Set(args.roles.split(',').map((role) => role.trim()).filter((role) => role !== ''))];

    const result = await mediforce.namespaces.setMemberRoles({
      handle: args.handle,
      uid: args.uid,
      grants: roles.map((role) => ({ role, workflowName })),
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Set process roles for ${result.uid} in ${args.handle}`);
    printKv(output, [
      ['roles', roles.length > 0 ? roles.join(', ') : '(none)'],
      ['scope', workflowName ?? 'every workflow in the workspace'],
    ]);
    return 0;
  },
});
