import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HandlerError } from '../errors.js';

const execFileAsync = promisify(execFile);

/**
 * Framework-free port for "remove a docker image from the platform's image
 * store." Two production implementations exist: a local `docker rmi` shell-out
 * (used when the deployment runs agents inline) and a remote call to the
 * container-worker (the standard production topology). The handler picks
 * neither — `platform-services` wires the correct one based on
 * `isLocalAgentMode()`.
 */
export interface DockerImageDeleter {
  delete(imageId: string): Promise<{ deleted: string; output?: string }>;
}

/**
 * Shells out to the local docker daemon. Used in the `ALLOW_LOCAL_AGENTS &&
 * !REDIS_URL` deployment topology — single-node, no worker, agents run inline
 * on the platform host.
 */
export class LocalDockerImageDeleter implements DockerImageDeleter {
  async delete(imageId: string): Promise<{ deleted: string; output?: string }> {
    try {
      const result = await execFileAsync('docker', ['rmi', imageId]);
      const trimmed = result.stdout.trim();
      return trimmed === ''
        ? { deleted: imageId }
        : { deleted: imageId, output: trimmed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HandlerError('internal', message);
    }
  }
}

/**
 * Forwards the delete to the container-worker over HTTP. The worker handles
 * actually invoking docker against the shared host daemon, so this client just
 * proxies the request. Non-2xx responses surface as `HandlerError('internal')`
 * — the legacy route mirrored the worker's status code, but the typed envelope
 * doesn't support arbitrary upstream codes, so 500 is the honest fallback.
 */
export class ContainerWorkerImageDeleter implements DockerImageDeleter {
  constructor(
    private readonly baseUrl: string,
    private readonly workerSecret?: string,
  ) {}

  async delete(imageId: string): Promise<{ deleted: string; output?: string }> {
    const headers: Record<string, string> = {};
    if (typeof this.workerSecret === 'string' && this.workerSecret !== '') {
      headers['X-Worker-Secret'] = this.workerSecret;
    }

    const res = await fetch(
      `${this.baseUrl}/images/${encodeURIComponent(imageId)}`,
      { method: 'DELETE', headers },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new HandlerError('internal', text);
    }

    return { deleted: imageId };
  }
}

/**
 * Mirrors the legacy route's `isLocalAgentMode()` check — exported here so
 * `platform-services` can pick the right deleter at wiring time without
 * duplicating the env logic across the codebase.
 */
export function isLocalAgentMode(): boolean {
  const redisUrl = process.env.REDIS_URL;
  return (
    process.env.ALLOW_LOCAL_AGENTS === 'true'
    && (redisUrl === undefined || redisUrl === '')
  );
}
