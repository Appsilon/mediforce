import type { PlatformSettingsRepository } from '@mediforce/platform-core';
import type { SetConfigInput, SetConfigOutput } from '../../contract/config';

export interface SetConfigDeps {
  platformSettingsRepo: PlatformSettingsRepository;
}

export async function setConfig(deps: SetConfigDeps, input: SetConfigInput): Promise<SetConfigOutput> {
  await deps.platformSettingsRepo.set(input.key, input.value);
  return { ok: true };
}
