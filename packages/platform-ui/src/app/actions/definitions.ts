'use server';

import { stringify as yamlStringify } from 'yaml';
import { getPlatformServices } from '@/lib/platform-services';
import { parseProcessDefinition } from '@mediforce/platform-core';
import type { ProcessDefinition, ProcessConfig } from '@mediforce/platform-core';
import { DefinitionVersionAlreadyExistsError } from '@mediforce/platform-infra';

export type SaveDefinitionResult =
  | { success: true; name: string; version: string }
  | { success: false; error: string };

export async function definitionToYaml(definition: Record<string, unknown>): Promise<string> {
  const { id, ...def } = definition;
  void id;
  return yamlStringify(def, { indent: 2 });
}

/**
 * Build a default "all-human" ProcessConfig from a definition.
 * Every non-terminal step gets executorType: "human" — the safest default.
 * Users must explicitly configure agent executors + plugins via the config editor.
 */
function buildAllHumanConfig(definition: ProcessDefinition): ProcessConfig {
  return {
    processName: definition.name,
    configName: 'all-human',
    configVersion: '1',
    stepConfigs: definition.steps
      .filter((s) => s.type !== 'terminal')
      .map((s) => ({ stepId: s.id, executorType: 'human' as const })),
  };
}

export async function saveDefinition(yaml: string): Promise<SaveDefinitionResult> {
  if (!yaml.trim()) {
    return { success: false, error: 'YAML content is required.' };
  }

  const result = parseProcessDefinition(yaml);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const { processRepo } = getPlatformServices();

  try {
    await processRepo.saveProcessDefinition(result.data);

    // Auto-create "all-human" default config if none exists yet
    const existing = await processRepo.getProcessConfig(result.data.name, 'all-human', 'v1');
    if (!existing) {
      await processRepo.saveProcessConfig(buildAllHumanConfig(result.data));
    }

    return { success: true, name: result.data.name, version: result.data.version };
  } catch (e) {
    if (e instanceof DefinitionVersionAlreadyExistsError) {
      return {
        success: false,
        error: `Version ${result.data.version} already exists for "${result.data.name}". Bump the version in your YAML.`,
      };
    }
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export type ArchiveResult = { success: true } | { success: false; error: string };

export async function setProcessArchived(
  processName: string,
  archived: boolean,
): Promise<ArchiveResult> {
  const { processRepo } = getPlatformServices();
  try {
    await processRepo.setProcessArchived(processName, archived);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
