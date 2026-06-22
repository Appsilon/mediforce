import { createRouteAdapter } from '@/lib/route-adapter';
import { cronHeartbeat } from '@mediforce/platform-api/handlers';
import { HeartbeatInputSchema } from '@mediforce/platform-api/contract';
import type { HeartbeatInput } from '@mediforce/platform-api/contract';

export const POST = createRouteAdapter<typeof HeartbeatInputSchema, HeartbeatInput>(
  HeartbeatInputSchema,
  () => ({}),
  cronHeartbeat,
);
