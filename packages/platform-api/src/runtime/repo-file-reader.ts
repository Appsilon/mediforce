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
}

/**
 * `git ls-tree -r` prints `<mode> <type> <oid>\t<path>`. Only blobs are kept:
 * a submodule is a commit in another repository, with nothing here to open.
 */
export function parseTreeListing(stdout: string): RepoTreeEntry[] {
  return stdout
    .split('\n')
    .flatMap((line) => {
      const match = /^\d+ blob [0-9a-f]+\t(.+)$/.exec(line);
      if (match === null) return [];
      return [{ path: match[1]! }];
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

/** Clones to a private temp directory and deletes it before returning. */
export function createGitRepoFileReader(): RepoFileReader {
  return {
    // `async` so a clone failure rejects rather than throwing synchronously:
    // the signature promises a Promise, and a caller that only catches
    // rejections would otherwise miss it.
    list: async ({ repo, commit, token, anonymousOnly }) => {
      const checkout = mkdtempSync(join(tmpdir(), 'mediforce-tree-'));
      try {
        cloneRepoAtCommit(checkout, repo, commit, token, {
          timeoutMs: CLONE_TIMEOUT_MS,
          treeless: true,
          ...(anonymousOnly === undefined ? {} : { anonymousOnly }),
        });
        const stdout = execFileSync(
          'git',
          ['-C', checkout, 'ls-tree', '-r', 'FETCH_HEAD'],
          { stdio: 'pipe', encoding: 'utf8', timeout: CLONE_TIMEOUT_MS },
        );
        return await Promise.resolve(parseTreeListing(stdout));
      } finally {
        rmSync(checkout, { recursive: true, force: true });
      }
    },

    open: async ({ repo, commit, path, token, maxBytes, anonymousOnly }) => {
      const checkout = mkdtempSync(join(tmpdir(), 'mediforce-open-'));
      try {
        cloneRepoAtCommit(checkout, repo, commit, token, {
          timeoutMs: CLONE_TIMEOUT_MS,
          treeless: true,
          ...(anonymousOnly === undefined ? {} : { anonymousOnly }),
        });

        // `git show` answers "no such path" itself, so the tree is not listed
        // again to check first: that listing is the expensive half of a read.
        // `maxBuffer` is the refusal — node abandons the blob once it passes
        // the cap rather than buffering it whole and then rejecting it.
        try {
          const raw = execFileSync('git', ['-C', checkout, 'show', `FETCH_HEAD:${path}`], {
            stdio: 'pipe',
            timeout: CLONE_TIMEOUT_MS,
            maxBuffer: maxBytes,
          });
          return await Promise.resolve({ path, contents: raw.toString('utf8') });
        } catch (error) {
          if (isMaxBufferExceeded(error)) return { path, maxBytes, tooLarge: true };
          if (isUnknownPath(error)) return null;
          throw error;
        }
      } finally {
        rmSync(checkout, { recursive: true, force: true });
      }
    },
  };
}

/** Records what it was asked for and returns fixed contents. Tests only. */
export interface StubRepoFileReader extends RepoFileReader {
  readonly reads: { repo: string; commit: string; paths: readonly string[]; token?: string }[];
  /** Entries `list` returns and `open` resolves against. Tests set this. */
  tree: RepoTreeEntry[];
}

export function createStubRepoFileReader(contents = '# stub\n'): StubRepoFileReader {
  const reads: { repo: string; commit: string; paths: readonly string[]; token?: string }[] = [];
  const stub: StubRepoFileReader = {
    reads,
    tree: [{ path: 'Dockerfile' }],
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
  };
  return stub;
}
