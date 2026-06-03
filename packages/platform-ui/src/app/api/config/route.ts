import { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getConfig, getConfigByPrefix, setConfig } from '@mediforce/platform-api/handlers';
import {
  GetConfigInputSchema,
  GetConfigByPrefixInputSchema,
  SetConfigInputSchema,
} from '@mediforce/platform-api/contract';
import type { NextRequest } from 'next/server';

const GetConfigQuerySchema = z.union([
  GetConfigByPrefixInputSchema,
  GetConfigInputSchema,
]);

export const GET = createRouteAdapter(
  GetConfigQuerySchema,
  (req: NextRequest) => {
    const prefix = req.nextUrl.searchParams.get('prefix');
    if (prefix !== null) return { prefix };
    return { key: req.nextUrl.searchParams.get('key') ?? '' };
  },
  async (input, scope) => {
    if ('prefix' in input) return getConfigByPrefix(input, scope);
    return getConfig(input, scope);
  },
);

export const PUT = createRouteAdapter(
  SetConfigInputSchema,
  async (req: NextRequest) => req.json(),
  setConfig,
);
