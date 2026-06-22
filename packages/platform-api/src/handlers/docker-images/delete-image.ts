import { assertCallerCanAdminDockerImages } from '../../auth';
import { emitAudit } from '../../audit-helpers';
import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { DeleteDockerImageInput, DeleteDockerImageOutput } from '../../contract/docker-images';

export async function deleteDockerImage(
  input: DeleteDockerImageInput,
  scope: CallerScope,
): Promise<DeleteDockerImageOutput> {
  assertCallerCanAdminDockerImages(scope.caller);

  const deleter = scope.system.dockerImages;
  if (deleter === null) {
    throw new PreconditionFailedError('Docker image deletion is not configured in this deployment');
  }

  const result = await deleter.delete(input.imageId);

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'docker_image.deleted',
    namespace: '_system',
    description: `Deleted docker image ${input.imageId}`,
    entityType: 'docker_image',
    entityId: input.imageId,
    basis: 'api-call',
    inputSnapshot: { imageId: input.imageId },
    outputSnapshot: { ...result },
  });

  return result;
}
