import { z } from 'zod';

export const DemandForecastSchema = z.object({
  id: z.string().min(1),
  skuId: z.string().min(1),
  warehouseId: z.string().min(1),
  weekStartDate: z.string(),
  demandUnits: z.number().int().nonnegative(),
});

export type DemandForecast = z.infer<typeof DemandForecastSchema>;
