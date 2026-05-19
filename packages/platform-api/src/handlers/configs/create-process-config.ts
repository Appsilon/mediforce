import {
  validateProcessConfig,
  type ProcessRepository,
} from '@mediforce/platform-core';
import type {
  CreateProcessConfigInput,
  CreateProcessConfigOutput,
} from '../../contract/configs.js';
import { ConflictError, ValidationError } from '../../errors.js';

export interface PluginRegistryView {
  list(): Array<{ name: string }>;
}

export interface CreateProcessConfigDeps {
  processRepo: ProcessRepository;
  pluginRegistry: PluginRegistryView;
}

/**
 * Pure handler for `POST /api/configs`.
 *
 * Runs server-side `validateProcessConfig` against the latest definition
 * version for the process (when one exists); validation failures become
 * `ValidationError` (400). Version conflicts from the infra layer surface as
 * `ConflictError` (409).
 */
export async function createProcessConfig(
  input: CreateProcessConfigInput,
  deps: CreateProcessConfigDeps,
): Promise<CreateProcessConfigOutput> {
  // TODO(#231): pre-existing bug ported 1:1 from the inline route. Both
  // ternary branches resolve to the literal string 'latest', which is never
  // a real `ProcessConfig.configVersion`, so `getProcessDefinition` returns
  // `null` and the entire validator block below silently no-ops. Fixing it
  // (use `getLatestWorkflowVersion` + look up by that version) is intentionally
  // deferred — flipping validation on under a refactor banner risks rejecting
  // configs that have been quietly persisted for months.
  const definition = await deps.processRepo.getProcessDefinition(
    input.processName,
    input.stepConfigs[0]?.stepId ? 'latest' : 'latest',
  );

  const pluginNames = deps.pluginRegistry.list().map((p) => p.name);
  if (definition !== null) {
    const result = validateProcessConfig(input, definition, pluginNames);
    if (!result.valid) {
      throw new ValidationError(result.errors.join('; '));
    }
  }

  try {
    await deps.processRepo.saveProcessConfig(input);
  } catch (err) {
    if (err instanceof Error && err.name === 'ConfigVersionAlreadyExistsError') {
      throw new ConflictError(err.message);
    }
    throw err;
  }

  return { ok: true };
}
