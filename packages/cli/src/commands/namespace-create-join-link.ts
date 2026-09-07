import { DEFAULT_JOIN_LINK_EXPIRY_DAYS } from '@mediforce/platform-api/contract';
import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

/**
 * Mint a workspace join link (ADR-0021).
 *
 * The printed URL is the ONLY time the token exists outside a hash — the
 * platform stores SHA-256 and nothing else, so a lost link is re-minted, never
 * recovered. That is why the human output leads with the URL rather than
 * burying it under the metadata.
 *
 * Redeeming the link does not sign anybody in: it seeds their account and
 * emails them the same activation link an invite sends. The link on the slide
 * is safe to photograph, and it only ever grants the plain `member` seat.
 */
export const namespaceCreateJoinLinkCommand = defineCommand({
  name: 'mediforce namespace create-join-link',
  description: 'Mint a join link for a workspace. Printed once — the token is never recoverable.',
  args: {
    handle: { type: 'positional', required: true, description: 'Workspace handle (organizations only)' },
    'expires-in-days': { type: 'string', description: `Validity window in days, 1-90 (default: ${DEFAULT_JOIN_LINK_EXPIRY_DAYS})` },
    'max-uses': { type: 'string', description: 'Cap on redemptions (default: uncapped)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const expiresInDays = parsePositiveInt(args['expires-in-days']);
    if (expiresInDays === 'invalid') {
      output.stderr(`Invalid --expires-in-days '${args['expires-in-days']}' — expected a positive integer`);
      return 2;
    }
    const maxUses = parsePositiveInt(args['max-uses']);
    if (maxUses === 'invalid') {
      output.stderr(`Invalid --max-uses '${args['max-uses']}' — expected a positive integer`);
      return 2;
    }

    const result = await mediforce.joinLinks.create({
      namespaceHandle: args.handle,
      expiresInDays: expiresInDays ?? DEFAULT_JOIN_LINK_EXPIRY_DAYS,
      ...(maxUses !== undefined ? { maxUses } : {}),
    });

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(result.url);
    output.stdout('');
    printKv(output, [
      ['id', result.link.id],
      ['grants', 'member'],
      ['expires', result.link.expiresAt],
      ['max uses', result.link.maxUses === null ? 'uncapped' : String(result.link.maxUses)],
    ]);
    output.stdout('');
    output.stdout('Copy it now — only its hash is stored, so it cannot be shown again.');
    return 0;
  },
});

/** `undefined` = flag absent, `'invalid'` = present but not a positive integer. */
function parsePositiveInt(raw: unknown): number | undefined | 'invalid' {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 && String(value) === raw.trim() ? value : 'invalid';
}
