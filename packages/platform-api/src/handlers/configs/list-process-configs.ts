import type { ProcessRepository } from '@mediforce/platform-core';
import type {
  ListProcessConfigsInput,
  ListProcessConfigsOutput,
} from '../../contract/configs.js';

export interface ListProcessConfigsDeps {
  processRepo: ProcessRepository;
}

/**
 * Pure handler: list every process config for `processName`.
 *
 * Returns an empty array — not a 404 — when no configs are registered for
 * the process. `processName` is required at the contract level, so missing
 * input is caught upstream by Zod (mapped to 400 by the route adapter).
 */
export async function listProcessConfigs(
  input: ListProcessConfigsInput,
  deps: ListProcessConfigsDeps,
): Promise<ListProcessConfigsOutput> {
  const configs = await deps.processRepo.listProcessConfigs(input.processName);
  return { configs };
}
