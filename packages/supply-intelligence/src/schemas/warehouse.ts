import { z } from 'zod';

export const WarehouseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  country: z.string().length(2),
});

export type Warehouse = z.infer<typeof WarehouseSchema>;
