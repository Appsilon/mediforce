import { spawn } from 'node:child_process';

/**
 * Best-effort removal of a pre-existing container by name before `docker run`.
 * Idempotent: succeeds whether or not a container with that name exists, and
 * never rejects — a failure here must not block the run.
 */
export function removeStaleContainer(containerName: string): Promise<void> {
  return new Promise((resolve) => {
    const rm = spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    rm.on('close', () => resolve());
    rm.on('error', () => resolve());
  });
}
