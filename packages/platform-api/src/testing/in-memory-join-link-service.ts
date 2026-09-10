import { joinLinkStatus } from '../services/join-link';
import type {
  CreateJoinLinkRecord,
  JoinLink,
  JoinLinkLookup,
  JoinLinkRejection,
  JoinLinkService,
} from '../services/join-link';

/**
 * In-memory `JoinLinkService` for handler tests (ADR-0021).
 *
 * Defers to `joinLinkStatus` for the rejection ordering rather than keeping its
 * own copy, so the fake cannot drift from what the settings list, the CLI table
 * and the `/join` page all render. (The Postgres adapter cannot share it —
 * `platform-infra` does not depend on `platform-api` — which is precisely why a
 * third copy here would be one too many.)
 *
 * It does hold `PostgresJoinLinkService`'s one real invariant: `claim` is the
 * only thing that increments `uses`, and it refuses before incrementing. A fake
 * that let `find` consume, or that checked the cap after the increment, would
 * let a handler test pass against behaviour the database would not produce.
 */
export class InMemoryJoinLinkService implements JoinLinkService {
  private readonly links = new Map<string, JoinLink & { tokenHash: string }>();

  async create(record: CreateJoinLinkRecord): Promise<JoinLink> {
    const link = {
      id: record.id,
      workspace: record.workspace,
      tokenHash: record.tokenHash,
      expiresAt: record.expiresAt.toISOString(),
      maxUses: record.maxUses,
      uses: 0,
      createdBy: record.createdBy,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.links.set(record.id, link);
    return strip(link);
  }

  async listForWorkspace(workspace: string): Promise<readonly JoinLink[]> {
    return [...this.links.values()]
      .filter((link) => link.workspace === workspace)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(strip);
  }

  async revoke(workspace: string, id: string, now: Date): Promise<JoinLink | null> {
    const link = this.links.get(id);
    if (link === undefined || link.workspace !== workspace || link.revokedAt !== null) return null;
    const revoked = { ...link, revokedAt: now.toISOString() };
    this.links.set(id, revoked);
    return strip(revoked);
  }

  async find(tokenHash: string, now: Date): Promise<JoinLinkLookup> {
    const link = this.byTokenHash(tokenHash);
    if (link === undefined) return { ok: false, reason: 'not_found' };
    const rejection = rejectionFor(link, now);
    return rejection === null ? { ok: true, link: strip(link) } : { ok: false, reason: rejection };
  }

  async claim(tokenHash: string, now: Date): Promise<JoinLinkLookup> {
    const link = this.byTokenHash(tokenHash);
    if (link === undefined) return { ok: false, reason: 'not_found' };
    const rejection = rejectionFor(link, now);
    if (rejection !== null) return { ok: false, reason: rejection };
    const consumed = { ...link, uses: link.uses + 1 };
    this.links.set(link.id, consumed);
    return { ok: true, link: strip(consumed) };
  }

  private byTokenHash(tokenHash: string): (JoinLink & { tokenHash: string }) | undefined {
    return [...this.links.values()].find((link) => link.tokenHash === tokenHash);
  }
}

function strip(link: JoinLink & { tokenHash: string }): JoinLink {
  const { tokenHash: _tokenHash, ...rest } = link;
  return rest;
}

/** `null` when the link is redeemable; otherwise why it is not. */
function rejectionFor(link: JoinLink, now: Date): Exclude<JoinLinkRejection, 'not_found'> | null {
  const status = joinLinkStatus(link, now);
  return status === 'active' ? null : status;
}
