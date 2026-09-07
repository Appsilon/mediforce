import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

/**
 * Close a join link.
 *
 * Revoking removes nobody: everyone who already redeemed it stays a member, and
 * removing them is `namespace remove-member`, as it is for any other member. A
 * link is an entrance, not a tenancy (ADR-0021).
 */
export const namespaceRevokeJoinLinkCommand = defineCommand({
  name: 'mediforce namespace revoke-join-link',
  description: 'Revoke a join link. Members who already joined through it are not removed.',
  args: {
    handle: { type: 'positional', required: true, description: 'Workspace handle' },
    id: { type: 'positional', required: true, description: 'Join link id (from list-join-links)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.joinLinks.revoke({
      namespaceHandle: args.handle,
      id: args.id,
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Revoked join link ${result.link.id} in ${args.handle}`);
    printKv(output, [
      ['redeemed', String(result.link.uses)],
      ['revoked at', result.link.revokedAt ?? ''],
    ]);
    output.stdout('Members who already joined through it keep their membership.');
    return 0;
  },
});
