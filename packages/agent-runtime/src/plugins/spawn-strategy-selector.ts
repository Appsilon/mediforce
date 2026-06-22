import { LocalDockerSpawnStrategy, QueuedDockerSpawnStrategy, type DockerSpawnStrategy } from './docker-spawn-strategy';
import { KubernetesJobSpawnStrategy } from './kubernetes-job-spawn-strategy';
import { loadKubeConfig } from './kube-config';

let cached: DockerSpawnStrategy | null = null;

export function getSpawnStrategy(env: NodeJS.ProcessEnv = process.env): DockerSpawnStrategy {
  if (cached) return cached;
  const spawnMode = env.SPAWN_MODE ?? 'docker';
  switch (spawnMode) {
    case 'kuber':
      cached = new KubernetesJobSpawnStrategy(
        loadKubeConfig(env),
        { namespace: env.POD_NAMESPACE ?? 'default' },
      );
      break;
    case 'docker':
      cached = env.REDIS_URL ? new QueuedDockerSpawnStrategy() : new LocalDockerSpawnStrategy();
      break;
    default:
      throw new Error(`Unknown SPAWN_MODE: "${spawnMode}". Expected one of: docker, kuber.`);
  }
  return cached;
}

// Test-only: reset the cache between tests
export function resetSpawnStrategyCache(): void { cached = null; }
