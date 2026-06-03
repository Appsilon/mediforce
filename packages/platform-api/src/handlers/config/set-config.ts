import type { CallerScope } from '../../repositories/index';
import type { SetConfigInput, SetConfigOutput } from '../../contract/config';

export async function setConfig(input: SetConfigInput, scope: CallerScope): Promise<SetConfigOutput> {
  await scope.system.platformSettings.set(input.key, input.value);
  return { ok: true };
}
