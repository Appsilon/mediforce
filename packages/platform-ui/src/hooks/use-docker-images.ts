'use client';

export { useDockerImages } from '@/contexts/docker-images-context';

import { splitImageRef } from '@mediforce/platform-core';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';

export function isImageAvailable(images: DockerImageInfo[], imageRef: string): boolean {
  const { repository, tag } = splitImageRef(imageRef);
  return images.some((img) => img.repository === repository && img.tag === tag);
}
