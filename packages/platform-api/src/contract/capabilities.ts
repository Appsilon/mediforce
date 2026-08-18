import { z } from 'zod';

export const GetCapabilitiesInputSchema = z.object({});
export type GetCapabilitiesInput = z.infer<typeof GetCapabilitiesInputSchema>;

/**
 * Whether one platform capability is usable on this instance.
 *
 * Deliberately derived server-side: the client learns "email works, over SMTP",
 * never which env vars are set or missing.
 */
export const CapabilityStatusSchema = z.object({
  available: z.boolean(),
  /** How it is provided when available (e.g. `smtp`) — shown as a badge. */
  detail: z.string().optional(),
  /** Why it is unavailable, and who can fix it — shown on hover. */
  reason: z.string().optional(),
});
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

export const GetCapabilitiesOutputSchema = z.object({
  capabilities: z.record(z.string(), CapabilityStatusSchema),
});
export type GetCapabilitiesOutput = z.infer<typeof GetCapabilitiesOutputSchema>;
