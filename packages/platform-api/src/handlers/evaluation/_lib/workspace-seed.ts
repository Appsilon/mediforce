import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkspaceFileChange } from '@mediforce/platform-core';
import { ValidationError } from '../../../errors';

/**
 * The workspace an Eval Case starts from is a commit on the workflow's bare
 * repo (ADR-0023 D4), read with agent-runtime's `listCommitFiles` and
 * `readCommitFile`. These find it, and write a changed copy of it for a
 * synthesized case with git plumbing, the way the workspace manager seeds `main`.
 */

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

const COMMIT_ENV = {
  GIT_AUTHOR_NAME: 'Mediforce Evaluation',
  GIT_AUTHOR_EMAIL: 'evaluation@mediforce.dev',
  GIT_COMMITTER_NAME: 'Mediforce Evaluation',
  GIT_COMMITTER_EMAIL: 'evaluation@mediforce.dev',
};

async function git(bareRepoPath: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--git-dir', bareRepoPath, ...args], {
    encoding: 'utf-8',
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, ...env },
  });
  return stdout;
}

/** The workspace a step saw: the parent of the commit it produced on the run branch. */
export async function parentCommit(bareRepoPath: string, commitSha: string): Promise<string | null> {
  try {
    return (await git(bareRepoPath, ['rev-parse', `${commitSha}^`])).trim();
  } catch {
    // The first commit of a run branch has a parent; a missing repo or commit
    // means the workspace is gone, and the case starts from an empty one.
    return null;
  }
}

export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

/**
 * Applies file changes in order over a workspace read through `read`, and
 * returns what each touched path ends up holding (null: deleted). A change
 * that does not apply — deleting or editing a file that is not there,
 * replacing text a file does not contain — is refused, naming the change.
 */
export async function resolveFileChanges(
  read: (path: string) => Promise<Buffer | null>,
  changes: readonly WorkspaceFileChange[],
): Promise<Map<string, string | null>> {
  const contents = new Map<string, string | null>();
  const current = async (path: string, index: number): Promise<string | null> => {
    if (contents.has(path)) return contents.get(path) ?? null;
    const buffer = await read(path);
    if (buffer === null) return null;
    if (isBinary(buffer)) throw new ValidationError(`fileChanges[${index}]: '${path}' is a binary file; only text files are changed`);
    return buffer.toString('utf-8');
  };

  for (const [index, change] of changes.entries()) {
    switch (change.op) {
      case 'write':
        contents.set(change.path, change.content);
        break;
      case 'delete': {
        if (await current(change.path, index) === null) {
          throw new ValidationError(`fileChanges[${index}]: there is no file '${change.path}' to delete`);
        }
        contents.set(change.path, null);
        break;
      }
      case 'replace': {
        const text = await current(change.path, index);
        if (text === null) throw new ValidationError(`fileChanges[${index}]: there is no file '${change.path}' to change`);
        if (text.includes(change.search) === false) {
          throw new ValidationError(`fileChanges[${index}]: '${change.path}' does not contain the text to replace`);
        }
        contents.set(change.path, text.replace(change.search, () => change.replace));
        break;
      }
    }
  }
  return contents;
}

/**
 * Writes `baseCommit` with `contents` applied as a new commit on the bare
 * repo, and points `ref` at it so it is never garbage-collected — a trial
 * branches from it for as long as the case exists. Returns its sha.
 */
export async function commitWorkspaceChanges(
  bareRepoPath: string,
  baseCommit: string,
  contents: ReadonlyMap<string, string | null>,
  options: { readonly message: string; readonly ref: string },
): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), 'mediforce-eval-seed-'));
  const indexEnv = { GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    await git(bareRepoPath, ['read-tree', baseCommit], indexEnv);
    for (const [index, [path, content]] of [...contents.entries()].entries()) {
      if (content === null) {
        await git(bareRepoPath, ['update-index', '--force-remove', '--', path], indexEnv);
        continue;
      }
      const file = join(scratch, `blob-${index}`);
      await writeFile(file, content, 'utf-8');
      const blob = (await git(bareRepoPath, ['hash-object', '-w', file])).trim();
      const existing = (await git(bareRepoPath, ['ls-files', '-s', '--', path], indexEnv)).split(' ')[0];
      const mode = existing === undefined || existing === '' ? '100644' : existing;
      await git(bareRepoPath, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${path}`], indexEnv);
    }
    const tree = (await git(bareRepoPath, ['write-tree'], indexEnv)).trim();
    const commit = (await git(bareRepoPath, ['commit-tree', tree, '-p', baseCommit, '-m', options.message], COMMIT_ENV)).trim();
    await git(bareRepoPath, ['update-ref', options.ref, commit]);
    return commit;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
