import type { DockerImageInfo, DockerInfoResponse } from '../../../contract/system';

/** The entry every handler test catalogues, minus the namespace. */
export const TEALFLOW = {
  name: 'TealFlow agent',
  intent: 'R-based interactive exploration of ADaM datasets',
  source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'container/Dockerfile' },
} as const;

/** The canonical form `Appsilon/tealflow` becomes once stored. */
export const TEALFLOW_REPO_URL = 'git@github.com:Appsilon/tealflow.git';

/** A daemon that answered and holds nothing. */
export const EMPTY_DAEMON: DockerInfoResponse = daemonWith([]);

/** A daemon that answered, holding exactly these images. */
export function daemonWith(images: DockerImageInfo[]): DockerInfoResponse {
  return {
    available: true,
    images,
    disk: {
      images: { totalCount: images.length, size: '0B' },
      containers: { totalCount: 0, active: 0, size: '0B' },
      buildCache: { size: '0B' },
    },
  };
}

/** One `docker images` row, defaulting to a TealFlow build. */
export function builtImage(overrides: Partial<DockerImageInfo> = {}): DockerImageInfo {
  return {
    repository: 'mediforce-built',
    tag: 'aaaaaaaaaaaa',
    id: 'sha-1',
    size: '1.2GB',
    created: '2 days ago',
    buildRepo: TEALFLOW_REPO_URL,
    buildDockerfile: 'container/Dockerfile',
    buildCommit: 'abc1234',
    ...overrides,
  };
}
