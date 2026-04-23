import {
  parseProcessDefinition,
  type ProcessConfig,
  type ProcessRepository,
} from '@mediforce/platform-core';
import type {
  UpsertLegacyDefinitionInput,
  UpsertLegacyDefinitionOutput,
} from '../../contract/definitions.js';
import { ConflictError, ValidationError } from '../../errors.js';

export interface UpsertLegacyDefinitionDeps {
  processRepo: ProcessRepository;
}

/**
 * Name-based check used to recognise the infra layer's
 * `DefinitionVersionAlreadyExistsError` and `ConfigVersionAlreadyExistsError`
 * without importing `@mediforce/platform-infra` here — handlers stay pure.
 */
function isAlreadyExistsError(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

/**
 * Pure handler for `PUT /api/definitions`.
 *
 * Parses the incoming YAML, persists the legacy `ProcessDefinition`, and
 * auto-seeds an "all-human" `ProcessConfig` for the same version when one
 * doesn't already exist. Preserves pre-migration semantics 1:1.
 */
export async function upsertLegacyDefinition(
  input: UpsertLegacyDefinitionInput,
  deps: UpsertLegacyDefinitionDeps,
): Promise<UpsertLegacyDefinitionOutput> {
  const result = parseProcessDefinition(input.yaml);
  if (!result.success) {
    throw new ValidationError(result.error);
  }

  const definition = result.data;

  try {
    await deps.processRepo.saveProcessDefinition(definition);
  } catch (err) {
    if (isAlreadyExistsError(err, 'DefinitionVersionAlreadyExistsError')) {
      throw new ConflictError((err as Error).message);
    }
    throw err;
  }

  const allHumanVersion = definition.version;
  const existing = await deps.processRepo.getProcessConfig(
    definition.name,
    'all-human',
    allHumanVersion,
  );
  if (existing === null) {
    const allHumanConfig: ProcessConfig = {
      processName: definition.name,
      configName: 'all-human',
      configVersion: allHumanVersion,
      stepConfigs: definition.steps
        .filter((s) => s.type !== 'terminal')
        .map((s) => ({ stepId: s.id, executorType: 'human' as const })),
    };
    try {
      await deps.processRepo.saveProcessConfig(allHumanConfig);
    } catch (configErr) {
      if (!isAlreadyExistsError(configErr, 'ConfigVersionAlreadyExistsError')) {
        throw configErr;
      }
    }
  }

  return { success: true, name: definition.name, version: definition.version };
}
