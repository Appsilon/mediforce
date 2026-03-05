import { z } from 'zod';

export const InboundShipmentSchema = z.object({
  id: z.string().min(1),
  skuId: z.string().min(1),
  warehouseId: z.string().min(1),
  expectedArrivalDate: z.string(),
  quantity: z.number().int().positive(),
  status: z.enum(['confirmed', 'in-transit']),
});

export type InboundShipment = z.infer<typeof InboundShipmentSchema>;
