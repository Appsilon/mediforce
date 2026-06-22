import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KubeConfig } from '@kubernetes/client-node';
import type { BatchV1Api, CoreV1Api } from '@kubernetes/client-node';
import { getSpawnStrategy, resetSpawnStrategyCache } from '../spawn-strategy-selector';
import { LocalDockerSpawnStrategy, QueuedDockerSpawnStrategy } from '../docker-spawn-strategy';
import { KubernetesJobSpawnStrategy } from '../kubernetes-job-spawn-strategy';

describe('getSpawnStrategy', () => {
  let loadFromClusterSpy: ReturnType<typeof vi.spyOn>;
  let makeApiClientSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetSpawnStrategyCache();
  });

  afterEach(() => {
    loadFromClusterSpy?.mockRestore();
    makeApiClientSpy?.mockRestore();
  });

  it('returns KubernetesJobSpawnStrategy when SPAWN_MODE=kuber', () => {
    loadFromClusterSpy = vi.spyOn(KubeConfig.prototype, 'loadFromCluster').mockImplementation(() => {});
    makeApiClientSpy = vi.spyOn(KubeConfig.prototype, 'makeApiClient').mockReturnValue({} as BatchV1Api & CoreV1Api);
    const strategy = getSpawnStrategy({ SPAWN_MODE: 'kuber', KUBERNETES_SERVICE_HOST: '10.0.0.1' });
    expect(strategy).toBeInstanceOf(KubernetesJobSpawnStrategy);
  });

  it('returns QueuedDockerSpawnStrategy when SPAWN_MODE=docker and REDIS_URL is set', () => {
    const strategy = getSpawnStrategy({ SPAWN_MODE: 'docker', REDIS_URL: 'redis://x' });
    expect(strategy).toBeInstanceOf(QueuedDockerSpawnStrategy);
  });

  it('returns LocalDockerSpawnStrategy when SPAWN_MODE=docker and REDIS_URL is not set', () => {
    const strategy = getSpawnStrategy({ SPAWN_MODE: 'docker' });
    expect(strategy).toBeInstanceOf(LocalDockerSpawnStrategy);
  });

  it('throws an error with valid modes listed when SPAWN_MODE is unknown', () => {
    expect(() => getSpawnStrategy({ SPAWN_MODE: 'invalid' })).toThrow(/docker, kuber/);
  });
});
