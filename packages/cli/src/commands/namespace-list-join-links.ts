import { defineCommand } from '../define-command';
import { columnWidth, printJson } from '../output';

/**
 * The read half of `create-join-link` — which link is still live, how many
 * people walked through it, and which one to revoke. Without it the only view
 * of `workspace_join_links` is SQL, which is how a workshop link nobody closed
 * stays open.
 *
 * Tokens are absent by construction: the platform holds only their hashes.
 */
export const namespaceListJoinLinksCommand = defineCommand({
  name: 'mediforce namespace list-join-links',
  description: 'List a workspace’s join links (newest first), including revoked and expired ones.',
  args: {
    handle: { type: 'positional', required: true, description: 'Workspace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.joinLinks.list({ namespaceHandle: args.handle });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    if (result.links.length === 0) {
      output.stdout(`No join links in "${args.handle}".`);
      return 0;
    }

    const rows = result.links.map((link) => ({
      id: link.id,
      status: link.status,
      uses: link.maxUses === null ? `${link.uses}` : `${link.uses}/${link.maxUses}`,
      expires: link.expiresAt,
    }));

    output.stdout(`Join links in ${args.handle} (${rows.length}):`);
    const idWidth = columnWidth('ID', rows, (row) => row.id);
    const statusWidth = columnWidth('STATUS', rows, (row) => row.status);
    const usesWidth = columnWidth('USES', rows, (row) => row.uses);
    const line = (id: string, status: string, uses: string, expires: string): string =>
      `  ${id.padEnd(idWidth)}  ${status.padEnd(statusWidth)}  ${uses.padEnd(usesWidth)}  ${expires}`.trimEnd();

    output.stdout(line('ID', 'STATUS', 'USES', 'EXPIRES'));
    for (const row of rows) {
      output.stdout(line(row.id, row.status, row.uses, row.expires));
    }
    return 0;
  },
});
