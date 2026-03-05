import { z } from 'zod';

export const RiskLevelSchema = z.enum(['red', 'orange', 'green']);

export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RiskConfigSchema = z.object({
  id: z.string().default('default'),
  expiryRedThresholdCents: z.number().int().nonnegative(),
  expiryOrangeThresholdCents: z.number().int().nonnegative(),
  stockoutRedThresholdCents: z.number().int().nonnegative(),
  stockoutOrangeThresholdCents: z.number().int().nonnegative(),
  urgentExpiryDays: z.number().int().nonnegative(),
  urgentStockoutWeeks: z.number().int().nonnegative(),
});

export type RiskConfig = z.infer<typeof RiskConfigSchema>;

/** Default risk configuration with sensible thresholds for a pharma demo dataset */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  id: 'default',
  expiryRedThresholdCents: 500_000,       // EUR 5,000
  expiryOrangeThresholdCents: 100_000,    // EUR 1,000
  stockoutRedThresholdCents: 1_000_000,   // EUR 10,000
  stockoutOrangeThresholdCents: 250_000,  // EUR 2,500
  urgentExpiryDays: 30,
  urgentStockoutWeeks: 1,
};
