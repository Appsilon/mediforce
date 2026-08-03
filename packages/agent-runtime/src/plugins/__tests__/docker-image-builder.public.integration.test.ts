/**
 * Integration coverage for the public-repository transport.
 * Uses real git commands and a local URL rewrite, so no network or Docker daemon is required.
 */
import { execSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildImageFromRepo } from '../docker-image-builder';
import { createTestRepo } from './helpers/create-test-repo';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('public repository image build transport', () => {
  it('fetches owner/repo over anonymous HTTPS without reading a deploy key or token', async () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'mediforce-public-clone-'));
    temporaryPaths.push(testRoot);

    const sourceRepo = createTestRepo();
    temporaryPaths.push(sourceRepo.repoPath);

    const fakeGitHubRoot = join(testRoot, 'github');
    const fakeGitHubRepo = join(fakeGitHubRoot, 'owner', 'repo');
    mkdirSync(dirname(fakeGitHubRepo), { recursive: true });
    execSync(`git clone --bare "${sourceRepo.repoPath}" "${fakeGitHubRepo}"`, { stdio: 'pipe' });

    const gitConfigPath = join(testRoot, 'gitconfig');
    writeFileSync(
      gitConfigPath,
      `[url "file://${fakeGitHubRoot}/"]\n\tinsteadOf = https://github.com/\n`,
    );

    const fakeDockerBin = join(testRoot, 'bin');
    mkdirSync(fakeDockerBin);
    const dockerBuildMarker = join(testRoot, 'docker-build.txt');
    const fakeDockerPath = join(fakeDockerBin, 'docker');
    writeFileSync(
      fakeDockerPath,
      `#!/usr/bin/env python3
import os
import pathlib
import sys

if sys.argv[1] != "build":
    raise SystemExit("expected docker build")

context = pathlib.Path(sys.argv[-1])
dockerfile = context / "Dockerfile"
pathlib.Path(os.environ["DOCKER_BUILD_MARKER"]).write_text(dockerfile.read_text())
`,
    );
    chmodSync(fakeDockerPath, 0o755);

    const originalPath = process.env.PATH;
    const originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    const originalGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    const originalDeployKeyPath = process.env.DEPLOY_KEY_PATH;
    const originalGitSshCommand = process.env.GIT_SSH_COMMAND;
    const originalDockerBuildMarker = process.env.DOCKER_BUILD_MARKER;

    process.env.PATH = `${fakeDockerBin}:${originalPath ?? ''}`;
    process.env.GIT_CONFIG_GLOBAL = gitConfigPath;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.DEPLOY_KEY_PATH = join(testRoot, 'deploy-key-directory');
    mkdirSync(process.env.DEPLOY_KEY_PATH);
    delete process.env.GIT_SSH_COMMAND;
    process.env.DOCKER_BUILD_MARKER = dockerBuildMarker;

    try {
      await buildImageFromRepo({
        image: 'test-image',
        repoUrl: 'git@github.com:owner/repo.git',
        repoRef: 'owner/repo',
        commit: sourceRepo.commitSha,
      });
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
      if (originalGitConfigNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = originalGitConfigNoSystem;
      if (originalDeployKeyPath === undefined) delete process.env.DEPLOY_KEY_PATH;
      else process.env.DEPLOY_KEY_PATH = originalDeployKeyPath;
      if (originalGitSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = originalGitSshCommand;
      if (originalDockerBuildMarker === undefined) delete process.env.DOCKER_BUILD_MARKER;
      else process.env.DOCKER_BUILD_MARKER = originalDockerBuildMarker;
      sourceRepo.cleanup();
      const sourceRepoPathIndex = temporaryPaths.indexOf(sourceRepo.repoPath);
      if (sourceRepoPathIndex >= 0) temporaryPaths.splice(sourceRepoPathIndex, 1);
    }

    expect(readFileSync(dockerBuildMarker, 'utf8')).toContain('FROM alpine:3.21');
  }, 30_000);
});
