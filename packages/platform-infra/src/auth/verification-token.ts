import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { authVerificationTokens } from '../postgres/schema/auth-verification-token';
import type { Database } from '../postgres/client';

/** Hash a raw verification token the way @auth/core does, so a row we insert is
 *  accepted by the Auth.js `/api/auth/callback/email` handler. */
export function hashVerificationToken(rawToken: string, secret: string): string {
  return createHash('sha256').update(`${rawToken}${secret}`).digest('hex');
}

/** Insert an Auth.js-compatible verification token and return the RAW token to
 *  embed in a callback URL. Used to mint invite-activation links with a custom
 *  (long) expiry, independent of the Email provider's login maxAge. */
export async function mintVerificationToken(
  db: Database,
  identifier: string, // the invitee email (lower-cased by caller)
  expires: Date,
  secret: string, // AUTH_SECRET
): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');
  // Invalidate any earlier unexpired activation tokens for this identifier so a
  // "resend" truly REPLACES the prior link (only the newest is valid) instead
  // of leaving multiple live and letting the table grow unbounded.
  await db.transaction(async (tx) => {
    await tx
      .delete(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, identifier));
    await tx.insert(authVerificationTokens).values({
      identifier,
      token: hashVerificationToken(rawToken, secret),
      expires,
    });
  });
  return rawToken;
}
