'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { DockerImageInfo, DockerDiskInfo } from '@mediforce/platform-api/contract';

interface DockerImagesState {
  images: DockerImageInfo[];
  disk: DockerDiskInfo | null;
  isAvailable: boolean;
  isLoading: boolean;
}

const REFRESH_INTERVAL_MS = 60_000;

export function useDockerImages(): DockerImagesState {
  const [state, setState] = useState<DockerImagesState>({
    images: [],
    disk: null,
    isAvailable: false,
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchDockerInfo() {
      try {
        const res = await apiFetch('/api/system/docker-info');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.available === true) {
          setState({ images: data.images, disk: data.disk, isAvailable: true, isLoading: false });
        } else {
          setState({ images: [], disk: null, isAvailable: false, isLoading: false });
        }
      } catch {
        if (!cancelled) {
          setState({ images: [], disk: null, isAvailable: false, isLoading: false });
        }
      }
    }

    fetchDockerInfo();
    const interval = setInterval(fetchDockerInfo, REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return state;
}

export function isImageAvailable(images: DockerImageInfo[], imageRef: string): boolean {
  const [repo, tag = 'latest'] = imageRef.split(':');
  return images.some((img) => img.repository === repo && img.tag === tag);
}
