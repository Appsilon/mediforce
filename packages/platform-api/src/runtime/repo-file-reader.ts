import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { cloneRepoAtCommit } from '@mediforce/agent-runtime';

/** A preview is a person waiting on a page, so the fetch is bounded. */
const CLONE_TIMEOUT_MS = 30_000;

export interface RepoFile {
  readonly path: string;
  readonly contents: string;
}

/**
 * One file in the commit's tree.
 *
 * Deliberately no size: `ls-tree -l` reports one only by reading the blob, and
 * in the treeless clone this uses that means fetching every file in the
 * repository to list it — which is the cost the whole design avoids.
 */
export interface RepoTreeEntry {
  readonly path: string;
}

/** A file whose contents exceeded what may be sent to a browser. */
export interface RepoFileTooLarge {
  readonly path: string;
  readonly maxBytes: number;
  readonly tooLarge: true;
}

/** A file under a directory that is not text: a link, or bytes that are not UTF-8. */
export interface RepoFileRefused {
  readonly path: string;
  readonly refused: 'symlink' | 'not-text';
}

export type RepoDirectoryEntry = RepoFile | RepoFileTooLarge | RepoFileRefused;

/**
 * Reads named files out of a repository at one commit. An interface so the
 * clone is swapped at the composition root rather than branched on inside a
 * handler — the same shape as {@link RunKicker}.
 */
export interface RepoFileReader {
  /** Every file in the commit, by path. Contents are not read. */
  list(options: {
    readonly repo: string;
    readonly commit: string;
    readonly token?: string;
    /** Refuse any transport that would spend this deployment's own key. */
    readonly anonymousOnly?: boolean;
  }): Promise<RepoTreeEntry[]>;

  /**
   * One file, fetched only now. A file whose contents pass `maxBytes` comes
   * back as {@link RepoFileTooLarge}: the read is abandoned at the cap rather
   * than completed, because half a CSV helps nobody.
   */
  open(options: {
    readonly repo: string;
    readonly commit: string;
    readonly path: string;
    readonly token?: string;
    readonly maxBytes: number;
    readonly anonymousOnly?: boolean;
  }): Promise<RepoFile | RepoFileTooLarge | null>;

  /**
   * Every file under `dir`, read as UTF-8 text from one clone. Paths are from
   * the repository root. A symlink is reported, never followed, and so is a
   * file that is not text or passes `maxBytes`.
   */
  readDirectory(options: {
    readonly repo: string;
    readonly commit: string;
    readonly dir: string;
    readonly token?: string;
    readonly maxBytes: number;
    readonly anonymousOnly?: boolean;
  }): Promise<RepoDirectoryEntry[]>;
}

const SYMLINK_MODE = '120000';
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * `git ls-tree -r` prints `<mode> <type> <oid>\t<path>`. Only blobs are kept:
 * a submodule is a commit in another repository, with nothing here to open.
 */
export function parseTreeListing(stdout: string): RepoTreeEntry[] {
  return parseTreeBlobs(stdout).map(({ path }) => ({ path }));
}

/** {@link parseTreeListing} with each blob's mode, which says whether it is a symlink. */
function parseTreeBlobs(stdout: string): { path: string; mode: string }[] {
  return stdout
    .split('\n')
    .flatMap((line) => {
      const match = /^(\d+) blob [0-9a-f]+\t(.+)$/.exec(line);
      if (match === null) return [];
      return [{ mode: match[1]!, path: match[2]! }];
    });
}

/**
 * `git show` refuses a path it cannot resolve in the commit, and says so three
 * different ways: absent from the tree, present on disk but unindexed, and
 * climbing out of the repository entirely. All three mean "no such file here",
 * and the last is why traversal never reaches the host's filesystem.
 */
function isUnknownPath(error: unknown): boolean {
  const stderr = String((error as { stderr?: Buffer | string } | null)?.stderr ?? '');
  return stderr.includes('does not exist')
    || stderr.includes('outside repository')
    || stderr.includes('exists on disk, but not in');
}

/** Node reports an over-`maxBuffer` read as ENOBUFS on the spawn result. */
function isMaxBufferExceeded(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOBUFS';
}

/**
 * Run `read` against a treeless clone of `repo` at `commit` in a private temp
 * directory, deleted before returning. `async` so a clone failure rejects
 * rather than throwing synchronously: a caller that only catches rejections
 * would otherwise miss it.
 */
async function withCheckout<Result>(
  prefix: string,
  options: { repo: string; commit: string; token?: string; anonymousOnly?: boolean },
  read: (checkout: string) => Result,
): Promise<Result> {
  const checkout = mkdtempSync(join(tmpdir(), prefix));
  try {
    cloneRepoAtCommit(checkout, options.repo, options.commit, options.token, {
      timeoutMs: CLONE_TIMEOUT_MS,
      treeless: true,
      ...(options.anonymousOnly === undefined ? {} : { anonymousOnly: options.anonymousOnly }),
    });
    return await Promise.resolve(read(checkout));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

function listTree(checkout: string, pathspec: string[] = []): string {
  return execFileSync(
    'git',
    ['-C', checkout, 'ls-tree', '-r', 'FETCH_HEAD', ...pathspec],
    { stdio: 'pipe', encoding: 'utf8', timeout: CLONE_TIMEOUT_MS },
  );
}

/** `git show` caps the read at `maxBytes`: node abandons the blob once it
 *  passes the cap rather than buffering it whole and then rejecting it. */
function showBlob(checkout: string, path: string, maxBytes: number): Buffer {
  return execFileSync('git', ['-C', checkout, 'show', `FETCH_HEAD:${path}`], {
    stdio: 'pipe',
    timeout: CLONE_TIMEOUT_MS,
    maxBuffer: maxBytes,
  });
}

/** Clones to a private temp directory and deletes it before returning. */
export function createGitRepoFileReader(): RepoFileReader {
  return {
    list: ({ repo, commit, token, anonymousOnly }) =>
      withCheckout('mediforce-tree-', { repo, commit, token, anonymousOnly }, (checkout) => parseTreeListing(listTree(checkout))),

    // `git show` answers "no such path" itself, so the tree is not listed again
    // to check first: that listing is the expensive half of a read.
    open: ({ repo, commit, path, token, maxBytes, anonymousOnly }) =>
      withCheckout('mediforce-open-', { repo, commit, token, anonymousOnly }, (checkout): RepoFile | RepoFileTooLarge | null => {
        try {
          return { path, contents: showBlob(checkout, path, maxBytes).toString('utf8') };
        } catch (error) {
          if (isMaxBufferExceeded(error)) return { path, maxBytes, tooLarge: true };
          if (isUnknownPath(error)) return null;
          throw error;
        }
      }),

    readDirectory: ({ repo, commit, dir, token, maxBytes, anonymousOnly }) =>
      withCheckout('mediforce-dir-', { repo, commit, token, anonymousOnly }, (checkout) => {
        const pathspec = dir === '' ? [] : ['--', `${dir.replace(/\/+$/, '')}/`];
        return parseTreeBlobs(listTree(checkout, pathspec)).map(({ path, mode }): RepoDirectoryEntry => {
          if (mode === SYMLINK_MODE) return { path, refused: 'symlink' };
          try {
            return { path, contents: utf8.decode(showBlob(checkout, path, maxBytes)) };
          } catch (error) {
            if (isMaxBufferExceeded(error)) return { path, maxBytes, tooLarge: true };
            if (error instanceof TypeError) return { path, refused: 'not-text' };
            throw error;
          }
        });
      }),
  };
}

/** Records what it was asked for and returns fixed contents. Tests only. */
export interface StubRepoFileReader extends RepoFileReader {
  readonly reads: { repo: string; commit: string; paths: readonly string[]; token?: string }[];
  /** Entries `list` returns and `open` resolves against. Tests set this. */
  tree: RepoTreeEntry[];
  /** Per-path contents `readDirectory` returns; any other path reads the default. */
  files: Record<string, string>;
}

export function createStubRepoFileReader(contents = '# stub\n'): StubRepoFileReader {
  const reads: { repo: string; commit: string; paths: readonly string[]; token?: string }[] = [];
  const stub: StubRepoFileReader = {
    reads,
    tree: [{ path: 'Dockerfile' }],
    files: {},
    list: async ({ repo, commit, token }) => {
      reads.push({ repo, commit, paths: [], ...(token === undefined ? {} : { token }) });
      return Promise.resolve(stub.tree);
    },
    open: async ({ repo, commit, path, token, maxBytes }) => {
      reads.push({ repo, commit, paths: [path], ...(token === undefined ? {} : { token }) });
      const entry = stub.tree.find((candidate) => candidate.path === path);
      if (entry === undefined) return Promise.resolve(null);
      if (contents.length > maxBytes) return Promise.resolve({ path, maxBytes, tooLarge: true });
      return Promise.resolve({ path, contents });
    },
    readDirectory: async ({ repo, commit, dir, token, maxBytes }) => {
      const prefix = dir === '' ? '' : `${dir.replace(/\/+$/, '')}/`;
      const entries = stub.tree.filter((entry) => entry.path.startsWith(prefix));
      reads.push({ repo, commit, paths: entries.map((entry) => entry.path), ...(token === undefined ? {} : { token }) });
      return Promise.resolve(entries.map((entry): RepoDirectoryEntry => {
        const text = stub.files[entry.path] ?? contents;
        return text.length > maxBytes ? { path: entry.path, maxBytes, tooLarge: true } : { path: entry.path, contents: text };
      }));
    },
  };
  return stub;
}
