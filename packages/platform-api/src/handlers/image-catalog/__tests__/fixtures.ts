import type { DockerImageInfo } from '../../../contract/system';
import type { DaemonImageListing } from '../../system/_docker';

/** The entry every handler test catalogues, minus the namespace. */
export const TEALFLOW = {
  name: 'TealFlow agent',
  intent: 'R-based interactive exploration of ADaM datasets',
  source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'container/Dockerfile' },
} as const;

/** The canonical form `Appsilon/tealflow` becomes once stored. */
export const TEALFLOW_REPO_URL = 'git@github.com:Appsilon/tealflow.git';

/** A daemon nobody could reach — the `unknown` case, which is a state and not
 *  an error (ADR-0021 decision 2). */
export const UNREACHABLE_DAEMON: DaemonImageListing = { available: false, images: [] };

/** A daemon that answered and holds nothing. */
export const EMPTY_DAEMON: DaemonImageListing = daemonWith([]);

/** A daemon that answered, holding exactly these images. The catalog reads the
 *  listing alone — no disk statistics — so neither does this fixture. */
export function daemonWith(images: DockerImageInfo[]): DaemonImageListing {
  return { available: true, images };
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
