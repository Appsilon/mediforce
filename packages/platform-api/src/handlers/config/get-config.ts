import type { CallerScope } from '../../repositories/index';
import type { GetConfigInput, GetConfigOutput, GetConfigByPrefixInput, GetConfigByPrefixOutput } from '../../contract/config';

export async function getConfig(input: GetConfigInput, scope: CallerScope): Promise<GetConfigOutput> {
  const value = await scope.system.platformSettings.get(input.key);
  return { key: input.key, value };
}

export async function getConfigByPrefix(input: GetConfigByPrefixInput, scope: CallerScope): Promise<GetConfigByPrefixOutput> {
  const settings = await scope.system.platformSettings.getByPrefix(input.prefix);
  return { settings };
}
