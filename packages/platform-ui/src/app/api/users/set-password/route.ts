import { createRouteAdapter } from '@/lib/route-adapter';
import { SetPasswordInputSchema } from '@mediforce/platform-api/contract';
import { setPassword } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  SetPasswordInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  setPassword,
);
