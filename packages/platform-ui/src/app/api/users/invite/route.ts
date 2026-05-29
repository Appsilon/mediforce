import { createRouteAdapter } from '@/lib/route-adapter';
import { InviteUserInputSchema } from '@mediforce/platform-api/contract';
import { inviteUser } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  InviteUserInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  inviteUser,
  { successStatus: 201 },
);
