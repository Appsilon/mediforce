import { createRouteAdapter } from '@/lib/route-adapter';
import { SetMyModelSettingsInputSchema } from '@mediforce/platform-api/contract';
import type { SetMyModelSettingsInput } from '@mediforce/platform-api/contract';
import { setMyModelSettings } from '@mediforce/platform-api/handlers';

interface RouteContext {
  params: Promise<{ handle: string }>;
}

export const PUT = createRouteAdapter<typeof SetMyModelSettingsInputSchema, SetMyModelSettingsInput, unknown, RouteContext>(
  SetMyModelSettingsInputSchema,
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, handle: (await ctx.params).handle };
  },
  setMyModelSettings,
);
