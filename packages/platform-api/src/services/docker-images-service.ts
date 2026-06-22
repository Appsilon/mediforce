import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HandlerError } from '../errors';

const execFileAsync = promisify(execFile);

/**
 * Framework-free port for managing the platform's docker image store.
 * `platform-services` picks the right implementation based on
 * `isLocalAgentMode()`: local `docker rmi` shell-out vs container-worker HTTP.
 */
export interface DockerImagesService {
  delete(imageId: string): Promise<{ deleted: string; output?: string }>;
}

export class LocalDockerImagesService implements DockerImagesService {
  async delete(imageId: string): Promise<{ deleted: string; output?: string }> {
    try {
      const result = await execFileAsync('docker', ['rmi', imageId]);
      const trimmed = result.stdout.trim();
      return trimmed === '' ? { deleted: imageId } : { deleted: imageId, output: trimmed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HandlerError('internal', message);
    }
  }
}

/**
 * Non-2xx responses surface as `HandlerError('internal')` — the legacy route
 * mirrored the worker's status code, but the typed envelope doesn't support
 * arbitrary upstream codes, so 500 is the honest fallback.
 */
export class ContainerWorkerDockerImagesService implements DockerImagesService {
  constructor(
    private readonly baseUrl: string,
    private readonly workerSecret?: string,
  ) {}

  async delete(imageId: string): Promise<{ deleted: string; output?: string }> {
    const headers: Record<string, string> = {};
    if (typeof this.workerSecret === 'string' && this.workerSecret !== '') {
      headers['X-Worker-Secret'] = this.workerSecret;
    }

    const res = await fetch(`${this.baseUrl}/images/${encodeURIComponent(imageId)}`, { method: 'DELETE', headers });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new HandlerError('internal', text);
    }

    return { deleted: imageId };
  }
}

export function isLocalAgentMode(): boolean {
  const redisUrl = process.env.REDIS_URL;
  return process.env.ALLOW_LOCAL_AGENTS === 'true' && (redisUrl === undefined || redisUrl === '');
}
