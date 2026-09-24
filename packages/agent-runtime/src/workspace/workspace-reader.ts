/**
 * Read-only access to files committed on a workflow's bare repo — Output
 * Files on run branches, and any commit's tree — straight from git, no
 * worktree required, so it works after the worktree has been swept. Consumed
 * by @mediforce/platform-api for listing and download, and for the workspace
 * an Eval Case starts from.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bareRepoPathFor, defaultDataDir, runBranchName, type WorkflowIdentity } from './workspace-paths';
import { OUTPUT_FILES_REPO_ROOT, resolveOutputFileMaxBytes } from './output-files';

const execFileAsync = promisify(execFile);

const OUTPUT_FILES_PATH_PREFIX = `${OUTPUT_FILES_REPO_ROOT}/`;

// Generous stdout cap for git: at least 256 MiB, and never below the
// configured per-file Output File size cap (binary `git cat-file` payloads).
function gitMaxBuffer(): number {
  return Math.max(256 * 1024 * 1024, resolveOutputFileMaxBytes());
}

export interface OutputFileEntry {
  stepId: string;
  /** Path relative to `.mediforce/output/<stepId>/` (may contain slashes for nested dirs). */
  name: string;
  /** Repo-relative path: `.mediforce/output/<stepId>/<name>` — the download key. */
  path: string;
  /** Blob size in bytes. */
  size: number;
}

export interface WorkspaceReaderInit {
  /** Root dir for bare repos. Defaults to `${MEDIFORCE_DATA_DIR ?? ~/.mediforce}`. */
  dataDir?: string;
}

function assertOutputFilePath(path: string): void {
  const isUnderOutputRoot = path.startsWith(OUTPUT_FILES_PATH_PREFIX) && path.length > OUTPUT_FILES_PATH_PREFIX.length;
  const hasTraversalSegment = path.split('/').includes('..');
  if (isUnderOutputRoot === false || hasTraversalSegment === true) {
    throw new Error(
      `Refusing to read "${path}" — only paths under ${OUTPUT_FILES_PATH_PREFIX} without ".." segments are readable`,
    );
  }
}

export interface CommitFileEntry {
  /** Repo-relative path. */
  path: string;
  /** Blob size in bytes. */
  size: number;
}

/**
 * Every file of a revision (a commit or branch) on a bare repo, with its
 * size, via `git ls-tree -r -l`; only those under `pathPrefix` when given.
 * Returns [] when the repo, revision, or path doesn't exist.
 */
export async function listCommitFiles(bareRepoPath: string, revision: string, pathPrefix?: string): Promise<CommitFileEntry[]> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      'git',
      ['--git-dir', bareRepoPath, 'ls-tree', '-r', '-l', '-z', revision, ...(pathPrefix === undefined ? [] : ['--', pathPrefix])],
      { encoding: 'utf-8', maxBuffer: gitMaxBuffer() },
    );
    stdout = result.stdout;
  } catch {
    return [];
  }

  const entries: CommitFileEntry[] = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    const tabIndex = record.indexOf('\t');
    if (tabIndex < 0) continue;
    // Record format: `<mode> <type> <object> <size>\t<path>` (size padded).
    const [, objectType, , sizeText] = record.slice(0, tabIndex).trim().split(/\s+/);
    if (objectType !== 'blob') continue;
    entries.push({ path: record.slice(tabIndex + 1), size: Number(sizeText) });
  }
  return entries;
}

/**
 * One file's bytes at a revision via `git cat-file blob <revision>:<path>` —
 * binary-safe (stdout captured as a Buffer). Returns null when the repo,
 * revision, or file is missing, or when the path names a tree (`git show`
 * would render a textual directory listing instead; `cat-file blob` refuses
 * non-blobs).
 */
export async function readCommitFile(bareRepoPath: string, revision: string, path: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['--git-dir', bareRepoPath, 'cat-file', 'blob', `${revision}:${path}`],
      { encoding: 'buffer', maxBuffer: gitMaxBuffer() },
    );
    return stdout;
  } catch {
    return null;
  }
}

export class WorkspaceReader {
  private readonly dataDir: string;

  constructor(options: WorkspaceReaderInit = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir();
  }

  /**
   * All Output Files of one run, read from
   * `git ls-tree -r -l run/<runId> -- .mediforce/output/` on the bare repo.
   * Returns [] when the repo, branch, or directory doesn't exist.
   */
  async listOutputFiles(workflow: WorkflowIdentity, runId: string): Promise<OutputFileEntry[]> {
    const files = await listCommitFiles(bareRepoPathFor(this.dataDir, workflow), runBranchName(runId), OUTPUT_FILES_PATH_PREFIX);
    const entries: OutputFileEntry[] = [];
    for (const { path: repoPath, size } of files) {
      if (repoPath.startsWith(OUTPUT_FILES_PATH_PREFIX) === false) continue;
      const stepRelativePath = repoPath.slice(OUTPUT_FILES_PATH_PREFIX.length);
      const slashIndex = stepRelativePath.indexOf('/');
      if (slashIndex <= 0 || slashIndex === stepRelativePath.length - 1) continue;
      entries.push({
        stepId: stepRelativePath.slice(0, slashIndex),
        name: stepRelativePath.slice(slashIndex + 1),
        path: repoPath,
        size,
      });
    }
    return entries;
  }

  /**
   * One file's bytes via `git cat-file blob run/<runId>:<path>` — binary-safe
   * (stdout captured as a Buffer). Returns null when the repo, branch, or
   * file is missing, or when the path names a tree (`git show` would render
   * a textual directory listing instead; `cat-file blob` refuses non-blobs).
   * Throws on paths outside `.mediforce/output/` or containing `..` segments.
   */
  async readOutputFile(workflow: WorkflowIdentity, runId: string, path: string): Promise<Buffer | null> {
    assertOutputFilePath(path);
    return readCommitFile(bareRepoPathFor(this.dataDir, workflow), runBranchName(runId), path);
  }

  /**
   * All Output Files as a zip archive via `git archive`. Entries are rooted
   * at the output tree (`<stepId>/<fileName>`) — the `.mediforce/output/`
   * prefix is stripped by archiving the subtree object directly.
   * Returns null when the repo, branch, or output directory doesn't exist.
   */
  async archiveOutputFiles(workflow: WorkflowIdentity, runId: string): Promise<Buffer | null> {
    const bareRepoPath = bareRepoPathFor(this.dataDir, workflow);
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['archive', '--format=zip', `${runBranchName(runId)}:${OUTPUT_FILES_REPO_ROOT}`],
        { cwd: bareRepoPath, encoding: 'buffer', maxBuffer: gitMaxBuffer() },
      );
      return stdout;
    } catch {
      return null;
    }
  }
}
