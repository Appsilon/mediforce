import { ForbiddenError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { GetConfigInput, GetConfigOutput, GetConfigByPrefixInput, GetConfigByPrefixOutput } from '../../contract/config';

/**
 * Platform settings are deployment-global and may hold secrets (e.g.
 * `alert.webhook.url`). Reads are operator-only — only system-actor callers
 * (CLI / agent runtime with an api key) may read them, mirroring the write
 * gate in `setConfig`; an authenticated end user must not exfiltrate them.
 */
export async function getConfig(input: GetConfigInput, scope: CallerScope): Promise<GetConfigOutput> {
  if (!scope.caller.isSystemActor) throw new ForbiddenError();
  const value = await scope.system.platformSettings.get(input.key);
  return { key: input.key, value };
}

export async function getConfigByPrefix(input: GetConfigByPrefixInput, scope: CallerScope): Promise<GetConfigByPrefixOutput> {
  if (!scope.caller.isSystemActor) throw new ForbiddenError();
  const settings = await scope.system.platformSettings.getByPrefix(input.prefix);
  return { settings };
}
