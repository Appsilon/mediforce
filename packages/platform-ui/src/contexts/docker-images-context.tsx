'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
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
  const cancelledRef = useRef(false);

  const fetchDockerInfo = useCallback(async () => {
    try {
      const res = await apiFetch('/api/system/docker-info');
      if (!res.ok || cancelledRef.current) return;
      const data = await res.json();
      if (cancelledRef.current) return;
      if (data.available === true) {
        setState({ images: data.images, disk: data.disk, isAvailable: true, isLoading: false });
      } else {
        setState({ images: [], disk: null, isAvailable: false, isLoading: false });
      }
    } catch {
      if (!cancelledRef.current) {
        setState({ images: [], disk: null, isAvailable: false, isLoading: false });
      }
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    fetchDockerInfo();
    const interval = setInterval(fetchDockerInfo, REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [fetchDockerInfo]);

  return (
    <DockerImagesContext.Provider value={{ ...state, refresh: fetchDockerInfo }}>
      {children}
    </DockerImagesContext.Provider>
  );
}

export function useDockerImages(): DockerImagesState {
  return useContext(DockerImagesContext);
}
