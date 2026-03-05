import { z } from 'zod';

export const BatchSchema = z.object({
  id: z.string().min(1),
  skuId: z.string().min(1),
  warehouseId: z.string().min(1),
  lotNumber: z.string().min(1),
  quantityOnHand: z.number().int().nonnegative(),
  unitCostCents: z.number().int().nonnegative(),
  manufacturingDate: z.string(),
  expiryDate: z.string(),
});

export type Batch = z.infer<typeof BatchSchema>;
