import { mkdtempSync, existsSync, lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { cloneRepoAtCommit } from '@mediforce/agent-runtime';

/** A preview is a person waiting on a page, so the fetch is bounded. */
const CLONE_TIMEOUT_MS = 30_000;

export interface RepoFile {
  readonly path: string;
  readonly contents: string;
  readonly truncated?: boolean;
}

/**
 * Reads named files out of a repository at one commit. An interface so the
 * clone is swapped at the composition root rather than branched on inside a
 * handler — the same shape as {@link RunKicker}.
 */
export interface RepoFileReader {
  read(options: {
    readonly repo: string;
    readonly commit: string;
    readonly paths: readonly string[];
    readonly token?: string;
    readonly maxBytes: number;
  }): Promise<RepoFile[]>;
}

/**
 * Read one file from a checkout, refusing anything that is not a regular file
 * living under `root`.
 *
 * Both guards are load-bearing and neither is obvious:
 *
 *  - `lstat` rather than `stat`, because `git checkout` materialises symlinks
 *    from the repository. A repo holding `Dockerfile -> /etc/passwd` otherwise
 *    reads the host's file: `stat` follows the link, reports a regular file,
 *    and `readFileSync` returns the target's contents.
 *  - `root + sep` rather than `root`, because a bare prefix test also accepts a
 *    sibling directory whose name merely starts with the checkout's.
 */
function readOne(root: string, path: string, maxBytes: number): RepoFile | null {
  const full = join(root, path);
  if (full.startsWith(root + sep) === false) return null;
  if (!existsSync(full)) return null;
  if (lstatSync(full).isFile() === false) return null;
  // The checkout root itself may sit behind a symlinked tmpdir, so compare
  // resolved paths rather than assuming the literal prefix survives.
  if (realpathSync(full).startsWith(realpathSync(root) + sep) === false) return null;

  const raw = readFileSync(full);
  if (raw.byteLength <= maxBytes) return { path, contents: raw.toString('utf8') };

  // Decoding a byte slice can split a character in half, so the cut is moved
  // back to the last boundary rather than emitting a replacement glyph.
  const decoder = new TextDecoder('utf8', { fatal: false, ignoreBOM: true });
  const text = decoder.decode(raw.subarray(0, maxBytes));
  return { path, contents: text.replace(/�$/, ''), truncated: true };
}

/** Clones to a private temp directory and deletes it before returning. */
export function createGitRepoFileReader(): RepoFileReader {
  return {
    // `async` so a clone failure rejects rather than throwing synchronously:
    // the signature promises a Promise, and a caller that only catches
    // rejections would otherwise miss it.
    read: async ({ repo, commit, paths, token, maxBytes }) => {
      const checkout = mkdtempSync(join(tmpdir(), 'mediforce-preview-'));
      try {
        cloneRepoAtCommit(checkout, repo, commit, token, { timeoutMs: CLONE_TIMEOUT_MS });
        return await Promise.resolve(paths
          .map((path) => readOne(checkout, path, maxBytes))
          .filter((file): file is RepoFile => file !== null));
      } finally {
        rmSync(checkout, { recursive: true, force: true });
      }
    },
  };
}

/** Records what it was asked for and returns fixed contents. Tests only. */
export interface StubRepoFileReader extends RepoFileReader {
  readonly reads: { repo: string; commit: string; paths: readonly string[]; token?: string }[];
}

export function createStubRepoFileReader(contents = '# stub\n'): StubRepoFileReader {
  const reads: { repo: string; commit: string; paths: readonly string[]; token?: string }[] = [];
  return {
    reads,
    read: async ({ repo, commit, paths, token }) => {
      reads.push({ repo, commit, paths, ...(token === undefined ? {} : { token }) });
      return Promise.resolve(paths.map((path) => ({ path, contents })));
    },
  };
}
