import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { upsertLegacyDefinition } from '@mediforce/platform-api/handlers';
import { UpsertLegacyDefinitionInputSchema } from '@mediforce/platform-api/contract';

/**
 * PUT /api/definitions
 *
 * Legacy YAML upload. Body: raw YAML text (not JSON). Handler parses,
 * validates, and auto-seeds an "all-human" config.
 */
export const PUT = createRouteAdapter(
  UpsertLegacyDefinitionInputSchema,
  async (req: NextRequest) => ({ yaml: await req.text() }),
  (input) =>
    upsertLegacyDefinition(input, { processRepo: getPlatformServices().processRepo }),
  { successStatus: 201 },
);
