import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildContextFilter,
  checkBuildContextSize,
  dockerignoreCandidates,
  packBuildContextArchive,
  type BuildContextArchiveEntry,
} from '@mediforce/platform-core';

export interface PackedContext {
  archive: Uint8Array<ArrayBuffer>;
  /** The ignore file applied, or null when the directory has none. */
  ignoreFile: string | null;
}

type FoundEntry =
  | { kind: 'file'; path: string; size: number; executable: boolean; modifiedMs: number }
  | { kind: 'directory'; path: string; modifiedMs: number }
  | { kind: 'symlink'; path: string; target: string; modifiedMs: number };

/** The first ignore file a build of `dockerfile` reads, as `docker build` picks it. */
async function readIgnoreFile(root: string, dockerfile: string): Promise<{ path: string; text: string } | null> {
  for (const path of dockerignoreCandidates(dockerfile)) {
    try {
      return { path, text: await readFile(join(root, path), 'utf8') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/**
 * A local directory as the archive `mediforce images build --context` uploads
 * (#1345): every file, directory and symlink under it that its `.dockerignore`
 * does not exclude — packed here rather than by the system `tar` (ADR-0022).
 * The walk only stats, and skips an excluded directory as Docker does, so a
 * context over the limit fails on its sizes before a byte is read.
 */
export async function packContextDirectory(root: string, dockerfile: string): Promise<PackedContext> {
  const rootStats = await lstat(root);
  if (rootStats.isDirectory() === false) {
    throw new Error(`--context "${root}" is not a directory.`);
  }

  const ignoreFile = await readIgnoreFile(root, dockerfile);
  const filter = buildContextFilter(dockerfile, ignoreFile);
  const found: FoundEntry[] = [];

  async function walk(relative: string): Promise<void> {
    const names = (await readdir(join(root, relative))).sort();
    for (const name of names) {
      const path = relative === '' ? name : `${relative}/${name}`;
      const absolute = join(root, path);
      const stats = await lstat(absolute);
      const modifiedMs = stats.mtimeMs;
      if (stats.isDirectory()) {
        if (filter.skipsDirectory(path)) continue;
        // An excluded directory is still walked when a `!` pattern may bring
        // something under it back; `tar` recreates it for whatever that is.
        if (filter.excludes(path) === false) found.push({ kind: 'directory', path, modifiedMs });
        await walk(path);
      } else if (filter.excludes(path)) {
        continue;
      } else if (stats.isSymbolicLink()) {
        found.push({ kind: 'symlink', path, target: await readlink(absolute), modifiedMs });
      } else if (stats.isFile()) {
        found.push({ kind: 'file', path, size: stats.size, executable: (stats.mode & 0o111) !== 0, modifiedMs });
      }
    }
  }

  await walk('');
  const files = found.filter((entry) => entry.kind === 'file');
  const size = checkBuildContextSize(
    files.reduce((total, entry) => total + entry.size, 0),
    files,
  );
  if (size.ok === false) throw new Error(size.message);

  const entries: BuildContextArchiveEntry[] = [];
  for (const entry of found) {
    if (entry.kind === 'file') {
      const { path, executable, modifiedMs } = entry;
      entries.push({ kind: 'file', path, executable, modifiedMs, content: await readFile(join(root, path)) });
    } else {
      entries.push(entry);
    }
  }
  return { archive: packBuildContextArchive(entries), ignoreFile: filter.ignoreFile };
}
