import { assertCallerCanAdminDockerImages } from '../../auth';
import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteDockerImageInput,
  DeleteDockerImageOutput,
} from '../../contract/docker-images';

export async function deleteDockerImage(
  input: DeleteDockerImageInput,
  scope: CallerScope,
): Promise<DeleteDockerImageOutput> {
  assertCallerCanAdminDockerImages(scope.caller);

  const deleter = scope.system.dockerImages;
  if (deleter === null) {
    throw new PreconditionFailedError(
      'Docker image deletion is not configured in this deployment',
    );
  }

  const result = await deleter.delete(input.imageId);

  // TODO(#592): re-enable audit emission once `_system` sentinel workspace
  // lands. PostgresAuditRepository.append throws here because this
  // platform-global handler has no workspace context (no processInstanceId,
  // no namespace), and InMemoryAuditRepository accepts it silently —
  // ADR-0001 Pattern #2 divergence tracked in #592.

  return result;
}
