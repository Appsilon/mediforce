/**
 * Integration tests for docker-image-builder.
 * Requires Docker daemon running. Skipped if Docker is not available.
 * Uses local bare git repos — no network required.
 */
import { execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  imageExistsLocally,
  getImageBuildCommit,
  buildImageFromRepo,
  ensureImage,
} from '../docker-image-builder.js';
import { createTestRepo, addCommitToTestRepo, type TestRepo } from './helpers/create-test-repo.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const testImagePrefix = `mediforce-test-${Date.now()}`;
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
      // Image may not have been created in a failed test
    }
  }
});

describe.skipIf(!dockerAvailable())('docker-image-builder integration', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = createTestRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('builds image from local bare repo', async () => {
    const image = testImageName('fresh-build');

    await buildImageFromRepo({
      image,
      repoUrl: repo.repoPath,
      commit: repo.commitSha,
    });

    const exists = await imageExistsLocally(image);
    expect(exists).toBe(true);

    const buildCommit = await getImageBuildCommit(image);
    expect(buildCommit).toBe(repo.commitSha);
  }, 60_000);

  it('ensureImage skips rebuild when commit matches', async () => {
    const image = testImageName('cache-reuse');

    // First build
    await ensureImage({
      image,
      repoUrl: repo.repoPath,
      commit: repo.commitSha,
    });

    // Get image ID
    const idBefore = execSync(`docker inspect --format '{{.Id}}' "${image}"`, { stdio: 'pipe' })
      .toString().trim();

    // Second call — should skip
    await ensureImage({
      image,
      repoUrl: repo.repoPath,
      commit: repo.commitSha,
    });

    const idAfter = execSync(`docker inspect --format '{{.Id}}' "${image}"`, { stdio: 'pipe' })
      .toString().trim();

    expect(idAfter).toBe(idBefore);
  }, 60_000);

  it('rebuilds when commit changes (stale detection)', async () => {
    const image = testImageName('stale-rebuild');

    // Build with initial commit
    await ensureImage({
      image,
      repoUrl: repo.repoPath,
      commit: repo.commitSha,
    });

    const idBefore = execSync(`docker inspect --format '{{.Id}}' "${image}"`, { stdio: 'pipe' })
      .toString().trim();

    // Add new commit with different content
    const newCommit = addCommitToTestRepo(repo.repoPath, {
      'run.sh': '#!/bin/sh\necho \'{"status":"updated"}\' > /output/result.json\n',
    });

    // Rebuild with new commit
    await ensureImage({
      image,
      repoUrl: repo.repoPath,
      commit: newCommit,
    });

    const idAfter = execSync(`docker inspect --format '{{.Id}}' "${image}"`, { stdio: 'pipe' })
      .toString().trim();
    const buildCommit = await getImageBuildCommit(image);

    expect(idAfter).not.toBe(idBefore);
    expect(buildCommit).toBe(newCommit);
  }, 60_000);

  it('fails clearly when Dockerfile is missing', async () => {
    const repoNoDockerfile = createTestRepo({
      dockerfile: 'Dockerfile',
    });

    // Remove Dockerfile by creating a new commit without it
    const emptyCommit = addCommitToTestRepo(repoNoDockerfile.repoPath, {
      'Dockerfile': '', // empty — docker build will fail
      'run.sh': '#!/bin/sh\necho ok',
    });

    // Replace with a repo that has no Dockerfile at the expected path
    const repoWrongPath = createTestRepo();
    const image = testImageName('missing-dockerfile');

    try {
      await expect(
        buildImageFromRepo({
          image,
          repoUrl: repoWrongPath.repoPath,
          commit: repoWrongPath.commitSha,
          dockerfile: 'nonexistent/Dockerfile',
        }),
      ).rejects.toThrow();
    } finally {
      repoNoDockerfile.cleanup();
      repoWrongPath.cleanup();
    }
  }, 60_000);

  it('uses custom dockerfile path', async () => {
    const repoCustomPath = createTestRepo({
      dockerfilePath: 'container/Dockerfile',
    });

    const image = testImageName('custom-path');

    try {
      await buildImageFromRepo({
        image,
        repoUrl: repoCustomPath.repoPath,
        commit: repoCustomPath.commitSha,
        dockerfile: 'container/Dockerfile',
      });

      const exists = await imageExistsLocally(image);
      expect(exists).toBe(true);
    } finally {
      repoCustomPath.cleanup();
    }
  }, 60_000);

  it('throws when image missing and no repo+commit', async () => {
    await expect(
      ensureImage({ image: 'mediforce-nonexistent-image-xyz' }),
    ).rejects.toThrow(/not found locally.*no repo\+commit/i);
  });
});
