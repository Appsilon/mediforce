import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDeployKeyPath } from './container-plugin.js';

export const SKILLS_CACHE_DIR = join(tmpdir(), 'mediforce-skills-cache');

export function toHttpsWithToken(sshUrl: string, token: string): string {
  const match = sshUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (match) {
    return `https://x-access-token:${token}@github.com/${match[1]}.git`;
  }
  return sshUrl.replace('https://', `https://x-access-token:${token}@`);
}

/**
 * Clone a repo at `commit`, copy `<commit>:<skillsDir>` to a deterministic
 * cache path, return the cache path. Idempotent — second call with the
 * same key is a no-op (cache hit).
 */
export async function fetchSkillsCache(
  repoUrl: string,
  commit: string,
  skillsDir: string,
  repoToken?: string,
): Promise<string> {
  const hash = createHash('sha256')
    .update(`${repoUrl}\0${commit}\0${skillsDir}`)
    .digest('hex')
    .slice(0, 16);
  const cacheDir = join(SKILLS_CACHE_DIR, hash);

  if (existsSync(cacheDir)) {
    return cacheDir;
  }

  const cloneDir = mkdtempSync(join(tmpdir(), 'mediforce-skills-clone-'));
  try {
    const cloneUrl = repoToken !== undefined ? toHttpsWithToken(repoUrl, repoToken) : repoUrl;
    const deployKeyPath = prepareDeployKeyPath();
    const execOpts = {
      stdio: 'pipe' as const,
      env: {
        ...process.env,
        GIT_SSH_COMMAND: `ssh -i ${deployKeyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`,
      },
    };

    execSync(`git init "${cloneDir}"`, execOpts);
    execSync(`git -C "${cloneDir}" remote add origin "${cloneUrl}"`, execOpts);
    execSync(`git -C "${cloneDir}" fetch origin "${commit}" --depth 1`, execOpts);
    execSync(`git -C "${cloneDir}" checkout FETCH_HEAD`, execOpts);

    const sourceDir = join(cloneDir, skillsDir);
    if (!existsSync(sourceDir)) {
      throw new Error(
        `Skills directory "${skillsDir}" not found in repo ${repoUrl}@${commit.slice(0, 8)}`,
      );
    }

    mkdirSync(SKILLS_CACHE_DIR, { recursive: true });
    cpSync(sourceDir, cacheDir, { recursive: true });
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }

  return cacheDir;
}
