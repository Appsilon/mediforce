import { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { testWebhook } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  z.undefined(),
  () => undefined,
  testWebhook,
);
