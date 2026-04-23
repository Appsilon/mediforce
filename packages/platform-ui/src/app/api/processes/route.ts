import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import { createProcess } from '@mediforce/platform-api/handlers';
import { CreateProcessInputSchema } from '@mediforce/platform-api/contract';
import { triggerAutoRunner } from '@/lib/trigger-auto-runner';

/**
 * POST /api/processes
 *
 * Body: `{ definitionName: string; definitionVersion?: number; triggerName?: string; triggeredBy: string; payload?: object }`.
 */
export const POST = createRouteAdapter(
  CreateProcessInputSchema,
  async (req: NextRequest) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    // Legacy clients passed `version` as string; normalise to number.
    const legacyVersion =
      body.version !== undefined ? Number(body.version) : undefined;
    return {
      definitionName: body.definitionName,
      definitionVersion: body.definitionVersion ?? legacyVersion,
      triggerName: body.triggerName,
      triggeredBy: body.triggeredBy,
      payload: body.payload,
    };
  },
  (input) => {
    const { manualTrigger, processRepo } = getPlatformServices();
    return createProcess(input, {
      manualTrigger,
      processRepo,
      triggerRun: triggerAutoRunner,
    });
  },
);
