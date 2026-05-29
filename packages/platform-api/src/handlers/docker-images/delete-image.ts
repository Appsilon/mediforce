import { assertCallerCanAdminDockerImages } from '../../auth';
import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteDockerImageInput,
  DeleteDockerImageOutput,
} from '../../contract/docker-images';
import { actorFromCaller } from '../_helpers';

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

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'docker_image.deleted',
    description: `Docker image '${input.imageId}' deleted from platform image store`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { imageId: input.imageId },
    outputSnapshot: { deleted: result.deleted },
    basis: 'Docker image deleted via API',
    entityType: 'dockerImage',
    entityId: input.imageId,
  });

  return result;
}
