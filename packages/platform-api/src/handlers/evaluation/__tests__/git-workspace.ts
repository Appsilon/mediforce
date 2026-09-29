import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface GitWorkspace {
  /** What `gitMetadata.repoUrl` points at. */
  readonly repoPath: string;
  /** The workspace the step started from. */
  readonly seedCommit: string;
  /** The commit the step produced on top of it. */
  readonly stepCommit: string;
  git(...args: string[]): string;
  remove(): void;
}

/** A real repo holding `files` as the seed commit, and a step commit that adds `graded.json`. */
export function gitWorkspace(files: Record<string, string>): GitWorkspace {
  const dir = mkdtempSync(join(tmpdir(), 'mediforce-eval-ws-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf-8' }).trim();
  git('init', '-q');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const seedCommit = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'graded.json'), '{"findings":[]}');
  git('add', '-A');
  git('commit', '-qm', 'step');
  return {
    repoPath: join(dir, '.git'),
    seedCommit,
    stepCommit: git('rev-parse', 'HEAD'),
    git,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
