import { NextResponse } from 'next/server';
import { parseProcessDefinition } from '@mediforce/platform-core';
import type { ProcessConfig } from '@mediforce/platform-core';
import { DefinitionVersionAlreadyExistsError, ConfigVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

export async function PUT(request: Request): Promise<NextResponse> {
  const yaml = await request.text();
  if (!yaml.trim()) {
    return NextResponse.json({ error: 'YAML body is required' }, { status: 400 });
  }

  const result = parseProcessDefinition(yaml);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const definition = result.data;
  const { processRepo } = getPlatformServices();

  try {
    await processRepo.saveProcessDefinition(definition);

    // Auto-create "all-human" default config if none exists
    const allHumanVersion = definition.version;
    const existing = await processRepo.getProcessConfig(definition.name, 'all-human', allHumanVersion);
    if (!existing) {
      const allHumanConfig: ProcessConfig = {
        processName: definition.name,
        configName: 'all-human',
        configVersion: allHumanVersion,
        stepConfigs: definition.steps
          .filter((s) => s.type !== 'terminal')
          .map((s) => ({ stepId: s.id, executorType: 'human' as const })),
      };
      try {
        await processRepo.saveProcessConfig(allHumanConfig);
      } catch (configErr) {
        if (!(configErr instanceof ConfigVersionAlreadyExistsError)) {
          throw configErr;
        }
      }
    }

    return NextResponse.json(
      { success: true, name: definition.name, version: definition.version },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DefinitionVersionAlreadyExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
