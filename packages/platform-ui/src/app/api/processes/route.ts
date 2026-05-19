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
    // Legacy clients passed `version` as string. Normalise to number,
    // tolerating numeric strings ("3") and rejecting garbage ("abc") by
    // leaving the field undefined — the Zod schema then surfaces the real
    // failure ("definitionVersion: …") instead of a misleading
    // "must be greater than 0" from a coerced NaN.
    const legacyVersion = parseLegacyVersion(body.version);
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
  { successStatus: 201 },
);

function parseLegacyVersion(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}
