import { ForbiddenError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { SetConfigInput, SetConfigOutput } from '../../contract/config';

/**
 * Platform settings are deployment-global (e.g. `platform.baseUrl` controls the
 * host in every invite/resend email). Only system-actor callers — the CLI /
 * agent runtime hitting the API with an api key — may write them; an
 * authenticated end user must not be able to repoint deployment-wide config.
 */
export async function setConfig(input: SetConfigInput, scope: CallerScope): Promise<SetConfigOutput> {
  if (!scope.caller.isSystemActor) throw new ForbiddenError();
  await scope.system.platformSettings.set(input.key, input.value);
  return { ok: true };
}
