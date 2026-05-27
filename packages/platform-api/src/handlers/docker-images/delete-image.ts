import { assertCallerCanAdminDockerImages } from '../../auth.js';
import { PreconditionFailedError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  DeleteDockerImageInput,
  DeleteDockerImageOutput,
} from '../../contract/docker-images.js';
import { actorFromCaller } from '../_helpers.js';

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
