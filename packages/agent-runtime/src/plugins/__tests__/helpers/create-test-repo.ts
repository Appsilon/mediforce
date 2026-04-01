/**
 * Creates a local bare git repo for testing docker-image-builder.
 * No network required — everything is local filesystem.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TestRepo {
  /** Path to the bare git repo (use as repoUrl) */
  repoPath: string;
  /** SHA of the initial commit */
  commitSha: string;
  /** Clean up all temp directories */
  cleanup: () => void;
}

export interface CreateTestRepoOptions {
  /** Dockerfile content. Defaults to a minimal alpine image that runs /app/run.sh */
  dockerfile?: string;
  /** Script content written to run.sh. Defaults to writing {"status":"ok"} to /output/result.json */
  script?: string;
  /** Path for the Dockerfile relative to repo root. Defaults to 'Dockerfile' */
  dockerfilePath?: string;
}

const DEFAULT_DOCKERFILE = `FROM alpine:3.21
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh
CMD ["/bin/sh", "/app/run.sh"]
`;

const DEFAULT_SCRIPT = `#!/bin/sh
echo '{"status":"ok"}' > /output/result.json
`;

export function createTestRepo(options: CreateTestRepoOptions = {}): TestRepo {
  const dockerfile = options.dockerfile ?? DEFAULT_DOCKERFILE;
  const script = options.script ?? DEFAULT_SCRIPT;
  const dockerfilePath = options.dockerfilePath ?? 'Dockerfile';

  const bareDir = mkdtempSync(join(tmpdir(), 'mediforce-test-bare-'));
  const workDir = mkdtempSync(join(tmpdir(), 'mediforce-test-work-'));

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@test.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@test.com',
  };
  const execOpts = { env: gitEnv, stdio: 'pipe' as const };

  // Create bare repo
  execSync(`git init --bare "${bareDir}"`, execOpts);

  // Clone to worktree
  execSync(`git clone "${bareDir}" "${workDir}"`, execOpts);

  // Write Dockerfile (may be nested like container/Dockerfile)
  const dockerfileFullPath = join(workDir, dockerfilePath);
  const dockerfileDir = join(dockerfileFullPath, '..');
  mkdirSync(dockerfileDir, { recursive: true });
  writeFileSync(dockerfileFullPath, dockerfile);

  // Write script
  writeFileSync(join(workDir, 'run.sh'), script);

  // Commit and push
  execSync('git add -A', { ...execOpts, cwd: workDir });
  execSync('git commit -m "initial"', { ...execOpts, cwd: workDir });
  execSync('git push origin HEAD', { ...execOpts, cwd: workDir });

  const commitSha = execSync('git rev-parse HEAD', { ...execOpts, cwd: workDir })
    .toString()
    .trim();

  return {
    repoPath: bareDir,
    commitSha,
    cleanup: () => {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

/**
 * Add a new commit to an existing test repo.
 * Returns the new commit SHA.
 */
export function addCommitToTestRepo(
  repoPath: string,
  files: Record<string, string>,
  message = 'update',
): string {
  const workDir = mkdtempSync(join(tmpdir(), 'mediforce-test-update-'));

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@test.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@test.com',
  };
  const execOpts = { env: gitEnv, stdio: 'pipe' as const };

  execSync(`git clone "${repoPath}" "${workDir}"`, execOpts);

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(workDir, filePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  execSync('git add -A', { ...execOpts, cwd: workDir });
  execSync(`git commit -m "${message}"`, { ...execOpts, cwd: workDir });
  execSync('git push origin HEAD', { ...execOpts, cwd: workDir });

  const commitSha = execSync('git rev-parse HEAD', { ...execOpts, cwd: workDir })
    .toString()
    .trim();

  rmSync(workDir, { recursive: true, force: true });
  return commitSha;
}
