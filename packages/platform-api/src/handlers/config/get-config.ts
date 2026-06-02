import type { PlatformSettingsRepository } from '@mediforce/platform-core';
import type {
  GetConfigInput,
  GetConfigOutput,
  GetConfigByPrefixInput,
  GetConfigByPrefixOutput,
} from '../../contract/config';

export interface GetConfigDeps {
  platformSettingsRepo: PlatformSettingsRepository;
}

export async function getConfig(deps: GetConfigDeps, input: GetConfigInput): Promise<GetConfigOutput> {
  const value = await deps.platformSettingsRepo.get(input.key);
  return { key: input.key, value };
}

export async function getConfigByPrefix(
  deps: GetConfigDeps,
  input: GetConfigByPrefixInput,
): Promise<GetConfigByPrefixOutput> {
  const settings = await deps.platformSettingsRepo.getByPrefix(input.prefix);
  return { settings };
}
