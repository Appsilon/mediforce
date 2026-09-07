import { z } from 'zod';

/**
 * Workspace join links (ADR-0021).
 *
 * Two audiences, deliberately split. `Create` / `List` / `Revoke` are
 * owner-admin surfaces behind the ordinary authenticated adapter; `Preview` /
 * `Redeem` are the public `/join/<token>` pair, where the token — not a
 * session — is the authorization.
 */

const NamespaceHandleSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, 'namespaceHandle must be lowercase alphanumeric with hyphens only');

/** Never `owner`: no link handed to a room grants the seat that can delete the workspace. */
export const JoinLinkMembershipSchema = z.enum(['member', 'admin']);

export const JoinLinkStatusSchema = z.enum(['active', 'revoked', 'expired', 'exhausted']);

export const JoinLinkSchema = z.object({
  id: z.string(),
  namespaceHandle: z.string(),
  membership: JoinLinkMembershipSchema,
  expiresAt: z.string(),
  /** `null` = uncapped; the expiry is then the only limit. */
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  createdBy: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  status: JoinLinkStatusSchema,
});

export type JoinLinkView = z.infer<typeof JoinLinkSchema>;

/**
 * `expiresInDays` rather than an absolute instant: a link is minted for an
 * event, and "7 days" is the shape an admin thinks in. 90 is the ceiling — a
 * link that outlives the cohort it was minted for is an entrance nobody is
 * watching any more.
 */
export const DEFAULT_JOIN_LINK_EXPIRY_DAYS = 7;
export const MAX_JOIN_LINK_EXPIRY_DAYS = 90;

export const CreateJoinLinkInputSchema = z
  .object({
    namespaceHandle: NamespaceHandleSchema,
    membership: JoinLinkMembershipSchema.optional().default('member'),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(MAX_JOIN_LINK_EXPIRY_DAYS)
      .optional()
      .default(DEFAULT_JOIN_LINK_EXPIRY_DAYS),
    maxUses: z.number().int().min(1).max(10000).optional(),
  })
  .strict();

export const CreateJoinLinkOutputSchema = z.object({
  link: JoinLinkSchema,
  /**
   * The plaintext token, returned exactly once. Only its SHA-256 is stored, so
   * this response is the sole opportunity to capture it — a lost token is
   * re-minted, never recovered.
   */
  token: z.string(),
  /** The full `/join/<token>` URL, ready to paste onto a slide or a QR code. */
  url: z.string(),
});

export type CreateJoinLinkInput = z.infer<typeof CreateJoinLinkInputSchema>;
export type CreateJoinLinkOutput = z.infer<typeof CreateJoinLinkOutputSchema>;

export const ListJoinLinksInputSchema = z
  .object({ namespaceHandle: NamespaceHandleSchema })
  .strict();

export const ListJoinLinksOutputSchema = z.object({ links: z.array(JoinLinkSchema) });

export type ListJoinLinksInput = z.infer<typeof ListJoinLinksInputSchema>;
export type ListJoinLinksOutput = z.infer<typeof ListJoinLinksOutputSchema>;

export const RevokeJoinLinkInputSchema = z
  .object({
    namespaceHandle: NamespaceHandleSchema,
    id: z.string().min(1),
  })
  .strict();

export const RevokeJoinLinkOutputSchema = z.object({ link: JoinLinkSchema });

export type RevokeJoinLinkInput = z.infer<typeof RevokeJoinLinkInputSchema>;
export type RevokeJoinLinkOutput = z.infer<typeof RevokeJoinLinkOutputSchema>;

/**
 * Why a token was refused. Safe to render verbatim: the holder already has the
 * secret, so naming the reason leaks nothing and is what they need in order to
 * ask for a new link. This is the opposite of the stance on the redeemed
 * EMAIL, which answers identically whether or not it is already a member.
 */
export const JoinLinkRejectionSchema = z.enum(['not_found', 'revoked', 'expired', 'exhausted']);

export const PreviewJoinLinkInputSchema = z.object({ token: z.string().min(1) }).strict();

export const PreviewJoinLinkOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    namespaceHandle: z.string(),
    workspaceName: z.string(),
    membership: JoinLinkMembershipSchema,
  }),
  z.object({ ok: z.literal(false), reason: JoinLinkRejectionSchema }),
]);

export type PreviewJoinLinkInput = z.infer<typeof PreviewJoinLinkInputSchema>;
export type PreviewJoinLinkOutput = z.infer<typeof PreviewJoinLinkOutputSchema>;

export const RedeemJoinLinkInputSchema = z
  .object({
    token: z.string().min(1),
    email: z.string().email(),
    displayName: z.string().min(1).optional(),
  })
  .strict();

/**
 * The success branch carries no signal about the address: an email that was
 * already a member and one that was not produce the identical body, so `/join`
 * cannot be used to enumerate a workspace's roster.
 */
export const RedeemJoinLinkOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    namespaceHandle: z.string(),
    workspaceName: z.string(),
    emailSent: z.boolean(),
  }),
  z.object({ ok: z.literal(false), reason: JoinLinkRejectionSchema }),
]);

export type RedeemJoinLinkInput = z.infer<typeof RedeemJoinLinkInputSchema>;
export type RedeemJoinLinkOutput = z.infer<typeof RedeemJoinLinkOutputSchema>;
