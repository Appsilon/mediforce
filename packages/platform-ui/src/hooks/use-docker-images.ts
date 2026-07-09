'use client';

export { useDockerImages } from '@/contexts/docker-images-context';

import type { DockerImageInfo } from '@mediforce/platform-api/contract';

export function isImageAvailable(images: DockerImageInfo[], imageRef: string): boolean {
  const [repo, tag = 'latest'] = imageRef.split(':');
  return images.some((img) => img.repository === repo && img.tag === tag);
}
