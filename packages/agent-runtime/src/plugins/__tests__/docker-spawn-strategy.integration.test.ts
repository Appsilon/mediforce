/**
 * Integration tests for LocalDockerSpawnStrategy streaming.
 * Requires Docker daemon running. Skipped otherwise.
 *
 * Verifies that onStdoutLine callbacks fire while the container is still
 * executing (not just once batch-delivered after exit). Regression guard for
 * the agent log tab going empty after commit 516de45.
 */
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { LocalDockerSpawnStrategy } from '../docker-spawn-strategy.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())('LocalDockerSpawnStrategy integration', () => {
  it('invokes onStdoutLine for each line while the container is still running', async () => {
    const strategy = new LocalDockerSpawnStrategy();
    const seen: Array<{ line: string; elapsedMs: number }> = [];
    const startedAt = Date.now();

    const result = await strategy.spawn({
      dockerArgs: [
        'run', '--rm', 'alpine:3.19',
        'sh', '-c',
        // Emit three lines with meaningful gaps so the test can detect whether
        // callbacks arrive in real time or all at once after exit.
        'echo first; sleep 0.4; echo second; sleep 0.4; echo third',
      ],
      stdinPayload: null,
      timeoutMs: 30_000,
      containerName: `mediforce-test-stream-${Date.now()}`,
      processInstanceId: 'pi-test',
      stepId: 'step-test',
      outputDir: '/tmp',
      logFile: null,
      onStdoutLine: (line) => {
        seen.push({ line, elapsedMs: Date.now() - startedAt });
      },
    });

    expect(result.exitCode).toBe(0);
    expect(seen.map((entry) => entry.line)).toEqual(['first', 'second', 'third']);

    // Prove real-time streaming: the second line must arrive meaningfully later
    // than the first. If everything were batch-delivered after exit, the two
    // callbacks would fire within the same event-loop tick.
    const firstToSecond = seen[1].elapsedMs - seen[0].elapsedMs;
    expect(firstToSecond).toBeGreaterThan(200);
  }, 60_000);

  it('returns the full stdout unchanged even when streaming is active', async () => {
    const strategy = new LocalDockerSpawnStrategy();
    const result = await strategy.spawn({
      dockerArgs: [
        'run', '--rm', 'alpine:3.19',
        'sh', '-c',
        'printf "alpha\\nbeta\\ngamma\\n"',
      ],
      stdinPayload: null,
      timeoutMs: 30_000,
      containerName: `mediforce-test-stdout-${Date.now()}`,
      processInstanceId: 'pi-test',
      stepId: 'step-test',
      outputDir: '/tmp',
      logFile: null,
      onStdoutLine: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('alpha\nbeta\ngamma\n');
  }, 60_000);
});
