import { formatRoleGrant } from '@mediforce/platform-core';
import { defineCommand } from '../define-command';
import { printJson } from '../output';

/**
 * The read half of `set-member-roles`. Granting a process role from the CLI
 * without being able to read one back leaves the only view of `user_roles` in
 * SQL, which is how a grant that landed in the wrong workspace stays invisible.
 *
 * `namespace get` already prints a member list, but it reads
 * `namespaces.get`, whose member rows carry Membership only. Process roles
 * ride on `users.listMembers` (ADR-0019), so this is a separate call rather
 * than a flag on that command.
 *
 * The two columns are labelled because they are the distinction the whole
 * feature turns on: MEMBERSHIP is `owner|admin|member` (who administers the
 * workspace), PROCESS ROLES is `reviewer|PI|approver` (what they do in a
 * process).
 *
 * A grant narrowed to one workflow prints as `role@workflow` — the same
 * notation `set-member-roles` writes into the audit trail. Printing it bare
 * would render "reviewer everywhere" and "reviewer on tealflow only"
 * identically, which is the wrong-scope-invisible failure this command exists
 * to catch, one dimension down.
 */
export const namespaceListMembersCommand = defineCommand({
  name: 'mediforce namespace list-members',
  description:
    'List a workspace’s members with their process roles (reviewer, PI, …) alongside their owner|admin|member membership.',
  args: {
    handle: { type: 'positional', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.users.listMembers({ namespace: args.handle });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    if (result.members.length === 0) {
      output.stdout(`No members in "${args.handle}".`);
      return 0;
    }

    // Sorted so the output is stable across grant order — the same roster read
    // twice has to be diffable.
    const rows = result.members.map((member) => ({
      membership: member.role,
      uid: member.uid,
      roles: member.grants.map(formatRoleGrant).sort().join(', ') || '(none)',
      name: member.displayName ?? '',
    }));

    output.stdout(`Members of ${args.handle} (${rows.length}):`);
    const membershipWidth = width('MEMBERSHIP', rows, (row) => row.membership);
    const uidWidth = width('UID', rows, (row) => row.uid);
    const rolesWidth = width('PROCESS ROLES', rows, (row) => row.roles);
    const line = (
      membership: string,
      uid: string,
      roles: string,
      name: string,
    ): string =>
      `  ${membership.padEnd(membershipWidth)}  ${uid.padEnd(uidWidth)}  ${roles.padEnd(rolesWidth)}  ${name}`.trimEnd();

    output.stdout(line('MEMBERSHIP', 'UID', 'PROCESS ROLES', 'NAME'));
    for (const row of rows) {
      output.stdout(line(row.membership, row.uid, row.roles, row.name));
    }
    return 0;
  },
});

function width<TRow>(
  header: string,
  rows: readonly TRow[],
  pick: (row: TRow) => string,
): number {
  return Math.max(header.length, ...rows.map((row) => pick(row).length));
}
