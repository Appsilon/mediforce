import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import {
  listProcessConfigs,
  createProcessConfig,
} from '@mediforce/platform-api/handlers';
import {
  ListProcessConfigsInputSchema,
  CreateProcessConfigInputSchema,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/configs?processName=X — list configs for a process.
 */
export const GET = createRouteAdapter(
  ListProcessConfigsInputSchema,
  (req) => ({
    processName: new URL(req.url).searchParams.get('processName') ?? undefined,
  }),
  (input) =>
    listProcessConfigs(input, { processRepo: getPlatformServices().processRepo }),
);

/**
 * POST /api/configs — register a new config version.
 */
export const POST = createRouteAdapter(
  CreateProcessConfigInputSchema,
  async (req: NextRequest) => readJsonBody(req),
  (input) => {
    const { processRepo, pluginRegistry } = getPlatformServices();
    return createProcessConfig(input, { processRepo, pluginRegistry });
  },
);
