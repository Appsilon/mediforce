import { randomUUID } from 'node:crypto';
import { assertCallerIsNamespaceAdmin } from '../../auth';
import { NotFoundError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { CreateJoinLinkInput, CreateJoinLinkOutput } from '../../contract/join-links';
import { resolveInviteAppUrl } from '../../contract/config';
import { buildJoinUrl, hashJoinToken, mintJoinToken } from '../../services/join-link';
import { actorFromCaller, resolveConfiguredBaseUrl } from '../_helpers';
import { requireJoinLinkService, toJoinLinkView } from './_shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mint a workspace join link (ADR-0021 §1, §2, §3).
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` — the same
 *      `canManageMembers` gate that reveals **Invite user** (apiKey bypass).
 *   2. Organizations only. A personal workspace is one person's own space;
 *      strangers joining it is not a shape we want to have to reason about.
 *   3. The link grants the plain `member` seat, always — there is no choice to
 *      make and no column to store it in. A link handed to a room, or
 *      photographed off a slide, must not be able to confer workspace
 *      administration on whoever types an address into a public form.
 *   4. Mint a 32-byte token, store ONLY its SHA-256, and return the plaintext
 *      exactly once. A lost token is re-minted, never recovered.
 *   5. Append `invitation.link_created` to the audit log — recording the link
 *      id, never the token.
 */
export async function createJoinLink(
  input: CreateJoinLinkInput,
  scope: CallerScope,
): Promise<CreateJoinLinkOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);
  const service = requireJoinLinkService(scope);

  const namespace = await scope.workspaces.getNamespace(input.namespaceHandle);
  if (namespace === null) {
    throw new NotFoundError(`Workspace '${input.namespaceHandle}' not found`);
  }
  if (namespace.type === 'personal') {
    throw new PreconditionFailedError(
      'A personal workspace cannot mint join links — invite people to an organization workspace instead.',
    );
  }

  const now = new Date();
  const actor = actorFromCaller(scope);
  const token = mintJoinToken();
  const link = await service.create({
    id: randomUUID(),
    workspace: input.namespaceHandle,
    tokenHash: hashJoinToken(token),
    expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
    maxUses: input.maxUses ?? null,
    createdBy: actor.actorId,
  });

  // The configured `platform.baseUrl` first, so a deployment that set only the
  // DB setting still hands out a link to the real host — the same ladder the
  // invite emails climb.
  const baseUrl = (await resolveConfiguredBaseUrl(scope)) ?? resolveInviteAppUrl();

  await scope.system.audit.append({
    ...actor,
    action: 'invitation.link_created',
    description: `Join link created for namespace '${input.namespaceHandle}'`,
    timestamp: now.toISOString(),
    inputSnapshot: {
      namespaceHandle: input.namespaceHandle,
      expiresInDays: input.expiresInDays,
      maxUses: input.maxUses ?? null,
    },
    // The token is absent on purpose: an audit reader must not be able to
    // redeem what they are auditing.
    outputSnapshot: { id: link.id, expiresAt: link.expiresAt },
    basis: 'Join link created via API',
    entityType: 'invitation',
    entityId: link.id,
    namespace: input.namespaceHandle,
  });

  return {
    link: toJoinLinkView(link, now),
    token,
    url: buildJoinUrl(baseUrl, token),
  };
}
