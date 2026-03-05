import { z } from 'zod';

export const TherapeuticCategorySchema = z.enum([
  'cardiovascular',
  'oncology',
  'anti-infectives',
  'respiratory',
  'gastro',
]);

export type TherapeuticCategory = z.infer<typeof TherapeuticCategorySchema>;

export const SkuSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manufacturer: z.string().min(1),
  category: TherapeuticCategorySchema,
  unitCostCents: z.number().int().nonnegative(),
  monthlyDemand: z.number().int().nonnegative(),
  seasonalFactors: z.record(z.string(), z.number()).optional(),
});

export type Sku = z.infer<typeof SkuSchema>;
