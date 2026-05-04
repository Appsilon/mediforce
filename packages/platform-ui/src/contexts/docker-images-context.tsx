'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { DockerImageInfo, DockerDiskInfo } from '@mediforce/platform-api/contract';

interface DockerImagesState {
  images: DockerImageInfo[];
  disk: DockerDiskInfo | null;
  isAvailable: boolean;
  isLoading: boolean;
  refresh: () => void;
}

const REFRESH_INTERVAL_MS = 60_000;

const DockerImagesContext = createContext<DockerImagesState>({
  images: [],
  disk: null,
  isAvailable: false,
  isLoading: true,
  refresh: () => {},
});

export function DockerImagesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<DockerImagesState, 'refresh'>>({
    images: [],
    disk: null,
    isAvailable: false,
    isLoading: true,
  });
  const [tick, setTick] = useState(0);

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
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  return (
    <DockerImagesContext.Provider value={{ ...state, refresh }}>
      {children}
    </DockerImagesContext.Provider>
  );
}

export function useDockerImages(): DockerImagesState {
  return useContext(DockerImagesContext);
}
