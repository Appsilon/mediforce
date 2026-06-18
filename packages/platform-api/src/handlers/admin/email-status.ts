import type { GetEmailStatusInput, GetEmailStatusOutput } from '../../contract/email-status';
import type { CallerScope } from '../../repositories/caller-scope';
import { assertCallerCanAdminDockerImages } from '../../auth';

export async function getEmailStatus(
  _input: GetEmailStatusInput,
  scope: CallerScope,
): Promise<GetEmailStatusOutput> {
  assertCallerCanAdminDockerImages(scope.caller);
  const info = scope.system.emailProviderInfo;
  return {
    provider: info?.provider ?? null,
    configured: info?.configured ?? false,
    from: info?.from ?? null,
  };
}
