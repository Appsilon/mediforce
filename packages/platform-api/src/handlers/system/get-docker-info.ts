// @public-handler — deployment-global Docker introspection.
// Every authenticated user needs the image list (workflow editor, start-run
// button, processes problems panel, admin infra page); there is no
// per-workspace view to enforce.

import type { CallerScope } from '../../repositories/index.js';
import type { DockerInfoResponse } from '../../contract/system.js';
import {
  fetchFromContainerWorker,
  fetchFromLocalDocker,
  isLocalAgentMode,
} from './_docker.js';

export async function getDockerInfo(
  _input: Record<string, never>,
  _scope: CallerScope,
): Promise<DockerInfoResponse> {
  try {
    return isLocalAgentMode() ? await fetchFromLocalDocker() : await fetchFromContainerWorker();
  } catch {
    return { available: false };
  }
}
