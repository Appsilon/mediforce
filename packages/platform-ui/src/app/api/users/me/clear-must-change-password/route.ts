import { createRouteAdapter } from '@/lib/route-adapter';
import { ClearMustChangePasswordInputSchema } from '@mediforce/platform-api/contract';
import { clearMustChangePassword } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter(
  ClearMustChangePasswordInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  clearMustChangePassword,
);
