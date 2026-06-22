import { createRouteAdapter } from '@/lib/route-adapter';
import { getEmailStatus } from '@mediforce/platform-api/handlers';
import { GetEmailStatusInputSchema, type GetEmailStatusInput } from '@mediforce/platform-api/contract';

export const GET = createRouteAdapter<typeof GetEmailStatusInputSchema, GetEmailStatusInput>(
  GetEmailStatusInputSchema,
  () => ({}),
  getEmailStatus,
);
