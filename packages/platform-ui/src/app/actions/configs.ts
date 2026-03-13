'use server';

import {
  ProcessConfigSchema,
  validateProcessConfig,
} from '@mediforce/platform-core';
import type { StepConfig } from '@mediforce/platform-core';
import { ConfigVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

interface SaveConfigInput {
  processName: string;
  configName: string;
  configVersion: string;
  stepConfigs: StepConfig[];
}

interface SaveConfigResult {
  success: boolean;
  errors?: string[];
  warnings?: string[];
  error?: string;
  conflict?: boolean;
}

export async function saveConfig(input: SaveConfigInput): Promise<SaveConfigResult> {
  const parsed = ProcessConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid config',
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const config = parsed.data;
  const { processRepo, pluginRegistry } = getPlatformServices();

  const definition = await processRepo.getProcessDefinition(
    config.processName,
    'latest',
  );

  const pluginNames = pluginRegistry.list().map((p: { name: string }) => p.name);

  if (definition) {
    const result = validateProcessConfig(config, definition, pluginNames);
    if (!result.valid) {
      return {
        success: false,
        errors: result.errors,
        warnings: result.warnings,
      };
    }
  }

  try {
    await processRepo.saveProcessConfig(config);
  } catch (err) {
    if (err instanceof ConfigVersionAlreadyExistsError) {
      return { success: false, conflict: true, error: err.message };
    }
    throw err;
  }

  return { success: true };
}
