import { createRouteAdapter } from '@/lib/route-adapter';
import { ResendInviteInputSchema } from '@mediforce/platform-api/contract';
import { resendInvite } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  ResendInviteInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  resendInvite,
);
