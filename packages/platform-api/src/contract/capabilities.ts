import { z } from 'zod';

export const GetCapabilitiesInputSchema = z.object({});
export type GetCapabilitiesInput = z.infer<typeof GetCapabilitiesInputSchema>;

/**
 * Derived server-side on purpose: the client learns "email works, over SMTP",
 * never which env vars are set or missing.
 */
export const CapabilityStatusSchema = z.object({
  available: z.boolean(),
  detail: z.string().optional(),
  reason: z.string().optional(),
});
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

/** Explicit rather than an open record, so both ends are type-checked. */
export const GetCapabilitiesOutputSchema = z.object({
  capabilities: z.object({
    email: CapabilityStatusSchema,
    agents: CapabilityStatusSchema,
  }),
});
export type GetCapabilitiesOutput = z.infer<typeof GetCapabilitiesOutputSchema>;
