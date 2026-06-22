// @public-handler — deployment-global Docker introspection.
// Every authenticated user needs the image list (workflow editor, start-run
// button, processes problems panel, admin infra page); there is no
// per-workspace view to enforce.

import type { CallerScope } from '../../repositories/index';
import type { DockerInfoResponse, GetDockerInfoInput } from '../../contract/system';
import { fetchFromContainerWorker, fetchFromLocalDocker, isLocalAgentMode } from './_docker';

export async function getDockerInfo(_input: GetDockerInfoInput, _scope: CallerScope): Promise<DockerInfoResponse> {
  try {
    return isLocalAgentMode() ? await fetchFromLocalDocker() : await fetchFromContainerWorker();
  } catch {
    return { available: false };
  }
}
