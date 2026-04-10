/**
 * Tier 3: Full E2E test with LocalDockerSpawnStrategy.
 * Verifies the complete flow: missing image → auto-build → docker run → output.
 * Requires Docker daemon. Uses local bare git repo.
 */
import { execSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LocalDockerSpawnStrategy } from '../docker-spawn-strategy.js';
import { createTestRepo, type TestRepo } from './helpers/create-test-repo.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const testImagePrefix = `mediforce-e2e-${Date.now()}`;
const imagesToCleanup: string[] = [];

function testImageName(suffix: string): string {
  const name = `${testImagePrefix}-${suffix}`;
  imagesToCleanup.push(name);
  return name;
}

afterAll(() => {
  for (const image of imagesToCleanup) {
    try {
      execSync(`docker rmi -f "${image}"`, { stdio: 'pipe' });
    } catch {
      // Ignore
    }
  }
});

describe.skipIf(!dockerAvailable())('LocalDockerSpawnStrategy with lazy image build', () => {
  let repo: TestRepo;
  const strategy = new LocalDockerSpawnStrategy();

  beforeAll(() => {
    repo = createTestRepo({
      script: '#!/bin/sh\necho \'{"status":"ok","source":"lazy-build-test"}\' > /output/result.json\n',
    });
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('auto-builds missing image, runs container, and produces output', async () => {
    const image = testImageName('local-e2e');
    const outputDir = await mkdtemp(join(tmpdir(), 'mediforce-e2e-output-'));

    try {
      const result = await strategy.spawn({
        dockerArgs: [
          'run', '--rm',
          '-v', `${outputDir}:/output`,
          image,
        ],
        stdinPayload: null,
        timeoutMs: 60_000,
        containerName: `mediforce-e2e-test-${Date.now()}`,
        processInstanceId: 'test-process',
        stepId: 'test-step',
        outputDir,
        logFile: null,
        imageBuild: {
          image,
          repoUrl: repo.repoPath,
          commit: repo.commitSha,
        },
      });

      expect(result.exitCode).toBe(0);

      // Verify the container wrote expected output
      const resultJson = await readFile(join(outputDir, 'result.json'), 'utf-8');
      const parsed = JSON.parse(resultJson);
      expect(parsed).toEqual({ status: 'ok', source: 'lazy-build-test' });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 60_000);
});
