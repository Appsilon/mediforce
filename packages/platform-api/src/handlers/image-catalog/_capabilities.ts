import type { ImageCatalogEntry } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { getDockerInfo } from '../system/get-docker-info';
import { probeImageCapabilities } from '../system/_docker';
import { resolveEntryVersions } from './_versions';

export async function refreshEntryCapabilities(
  namespace: string,
  entry: ImageCatalogEntry,
  scope: CallerScope,
): Promise<ImageCatalogEntry> {
  const docker = await getDockerInfo({}, scope);
  if (!docker.available) return entry;

  const capabilities = { ...entry.capabilities };
  const versions = resolveEntryVersions(entry.source, docker.images);

  for (const version of versions) {
    const cached = capabilities[version.imageId];
    if (cached?.status === 'known') continue;
    capabilities[version.imageId] = await probeImageCapabilities(version.imageTag);
  }

  return scope.imageCatalog.upsert(namespace, { ...entry, capabilities });
}
