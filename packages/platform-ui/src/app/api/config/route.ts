import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformServices } from '@/lib/platform-services';
import { getConfig, getConfigByPrefix, setConfig } from '@mediforce/platform-api/handlers';
import {
  GetConfigInputSchema,
  GetConfigByPrefixInputSchema,
  SetConfigInputSchema,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/config?key=<key>          — get a single config value
 * GET /api/config?prefix=<prefix>   — get all config values matching a prefix
 * PUT /api/config                   — set a config value
 *
 * System-actor only (API key required). Used by `mediforce config get/set`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const { platformSettingsRepo } = getPlatformServices();

  const prefix = searchParams.get('prefix');
  if (prefix !== null) {
    try {
      const input = GetConfigByPrefixInputSchema.parse({ prefix });
      const result = await getConfigByPrefix({ platformSettingsRepo }, input);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Failed to get config' }, { status: 500 });
    }
  }

  const key = searchParams.get('key');
  if (key !== null) {
    try {
      const input = GetConfigInputSchema.parse({ key });
      const result = await getConfig({ platformSettingsRepo }, input);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Failed to get config' }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: 'Provide either ?key=<key> or ?prefix=<prefix>' },
    { status: 400 },
  );
}

export async function PUT(request: Request): Promise<NextResponse> {
  const { platformSettingsRepo } = getPlatformServices();
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const input = SetConfigInputSchema.parse(body);
    const result = await setConfig({ platformSettingsRepo }, input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to set config' }, { status: 500 });
  }
}
