import { NextResponse } from 'next/server';
import {
  ProcessConfigSchema,
  validateProcessConfig,
} from '@mediforce/platform-core';
import { ConfigVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { listProcessConfigs } from '@mediforce/platform-api/handlers';
import { ListProcessConfigsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/configs?processName=X
 *
 * Required `processName` query param (400 when missing). Returns
 * `{ configs: ProcessConfig[] }` — empty array when the process has none.
 */
export const GET = createRouteAdapter(
  ListProcessConfigsInputSchema,
  (req) => ({
    processName: new URL(req.url).searchParams.get('processName') ?? undefined,
  }),
  (input) =>
    listProcessConfigs(input, {
      processRepo: getPlatformServices().processRepo,
    }),
);

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ProcessConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid config', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const config = parsed.data;
  const { processRepo, pluginRegistry } = getPlatformServices();

  // Load definition for validation (use latest version heuristic -- get by processName)
  const definition = await processRepo.getProcessDefinition(
    config.processName,
    config.stepConfigs[0]?.stepId ? 'latest' : 'latest',
  );

  const pluginNames = pluginRegistry.list().map((p: { name: string }) => p.name);

  // Run server-side validation if definition is available
  if (definition) {
    const result = validateProcessConfig(config, definition, pluginNames);
    if (!result.valid) {
      return NextResponse.json(
        { errors: result.errors, warnings: result.warnings },
        { status: 400 },
      );
    }
  }

  try {
    await processRepo.saveProcessConfig(config);
  } catch (err) {
    if (err instanceof ConfigVersionAlreadyExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
