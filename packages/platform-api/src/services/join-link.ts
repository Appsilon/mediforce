import { createHash, randomBytes } from 'node:crypto';

/**
 * Workspace join links (ADR-0021).
 *
 * A join link authorizes MEMBERSHIP; the mailbox still authorizes the session.
 * Redeeming one seeds an account and sends the ordinary activation email, so a
 * link on a slide — or a photograph of that slide — can never be replayed into
 * anybody's account.
 *
 * Framework-free, like `invite-notification.ts` next to it: the Postgres
 * adapter (`PostgresJoinLinkService`) is wired through `CallerScope.system`.
 */

/** Membership a link may grant. Never `owner` (ADR-0021 §3). */
export type JoinLinkMembership = 'admin' | 'member';

export interface JoinLink {
  readonly id: string;
  readonly workspace: string;
  readonly membership: JoinLinkMembership;
  /** ISO-8601. */
  readonly expiresAt: string;
  /** `null` = uncapped; the expiry is then the only limit. */
  readonly maxUses: number | null;
  readonly uses: number;
  readonly createdBy: string;
  /** ISO-8601. */
  readonly createdAt: string;
  /** ISO-8601, or `null` while the link is live. */
  readonly revokedAt: string | null;
}

export interface CreateJoinLinkRecord {
  readonly id: string;
  readonly workspace: string;
  readonly tokenHash: string;
  readonly membership: JoinLinkMembership;
  readonly expiresAt: Date;
  readonly maxUses: number | null;
  readonly createdBy: string;
}

/**
 * Why a token cannot be used. `not_found` carries no link because there is
 * nothing to describe; the other three do, so the page can say when it expired.
 *
 * These reasons are safe to surface verbatim: the holder already possesses the
 * secret, so "this link expired" leaks nothing. That is the opposite of the
 * anti-enumeration stance on the redeemed EMAIL, which must answer identically
 * whether or not the address is already a member.
 */
export type JoinLinkRejection = 'not_found' | 'revoked' | 'expired' | 'exhausted';

export type JoinLinkLookup =
  | { readonly ok: true; readonly link: JoinLink }
  | { readonly ok: false; readonly reason: JoinLinkRejection };

export interface JoinLinkService {
  create(record: CreateJoinLinkRecord): Promise<JoinLink>;
  /** Every link of one workspace, newest first — revoked and expired included. */
  listForWorkspace(workspace: string): Promise<readonly JoinLink[]>;
  /** `null` when no live link with that id exists in `workspace`. */
  revoke(workspace: string, id: string, now: Date): Promise<JoinLink | null>;
  /** Read-only validity check for the `/join` landing page. Consumes nothing. */
  find(tokenHash: string, now: Date): Promise<JoinLinkLookup>;
  /**
   * Atomically consume one use. The ONLY place `uses` is incremented — the
   * check and the increment must share a transaction, or two attendees
   * redeeming the last seat of a capped link both succeed.
   */
  claim(tokenHash: string, now: Date): Promise<JoinLinkLookup>;
}

/**
 * The plaintext token. 32 random bytes, base64url — URL-safe, so it drops
 * straight into `/join/<token>` and into a QR code without escaping.
 */
export function mintJoinToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash is ever stored; the plaintext is shown once and never again. */
export function hashJoinToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * What a holder would hit if they tried the link now. `active` is the only
 * state that redeems; the other three are exactly `JoinLinkRejection` minus
 * `not_found`, which describes a token rather than a row.
 *
 * Derived here rather than in each of the three surfaces that render a link
 * (settings list, CLI table, `/join` page) so they cannot drift on the
 * revoked-outranks-expired-outranks-exhausted ordering.
 */
export type JoinLinkStatus = 'active' | 'revoked' | 'expired' | 'exhausted';

export function joinLinkStatus(link: JoinLink, now: Date): JoinLinkStatus {
  if (link.revokedAt !== null) return 'revoked';
  if (Date.parse(link.expiresAt) <= now.getTime()) return 'expired';
  if (link.maxUses !== null && link.uses >= link.maxUses) return 'exhausted';
  return 'active';
}

/** The URL an admin copies out of workspace settings. */
export function buildJoinUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/join/${token}`;
}
