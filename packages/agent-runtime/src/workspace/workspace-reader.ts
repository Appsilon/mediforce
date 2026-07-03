/**
 * Read-only access to Output Files committed on run branches, straight from
 * the bare repo — no worktree required, so it works after the worktree has
 * been swept. Consumed by @mediforce/platform-api for listing and download.
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
    const bareRepoPath = bareRepoPathFor(this.dataDir, workflow);
    let stdout: string;
    try {
      const result = await execFileAsync(
        'git',
        ['ls-tree', '-r', '-l', '-z', runBranchName(runId), '--', OUTPUT_FILES_PATH_PREFIX],
        { cwd: bareRepoPath, encoding: 'utf-8', maxBuffer: gitMaxBuffer() },
      );
      stdout = result.stdout;
    } catch {
      return [];
    }

    const entries: OutputFileEntry[] = [];
    for (const record of stdout.split('\0')) {
      if (record === '') continue;
      const tabIndex = record.indexOf('\t');
      if (tabIndex < 0) continue;
      // Record format: `<mode> <type> <object> <size>\t<path>` (size padded).
      const [, objectType, , sizeText] = record.slice(0, tabIndex).trim().split(/\s+/);
      if (objectType !== 'blob') continue;
      const repoPath = record.slice(tabIndex + 1);
      if (repoPath.startsWith(OUTPUT_FILES_PATH_PREFIX) === false) continue;
      const stepRelativePath = repoPath.slice(OUTPUT_FILES_PATH_PREFIX.length);
      const slashIndex = stepRelativePath.indexOf('/');
      if (slashIndex <= 0 || slashIndex === stepRelativePath.length - 1) continue;
      entries.push({
        stepId: stepRelativePath.slice(0, slashIndex),
        name: stepRelativePath.slice(slashIndex + 1),
        path: repoPath,
        size: Number(sizeText),
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
  /**
   * Stream all Output Files as a zip archive via `git archive --format=zip`.
   * Returns null when the repo, branch, or output directory doesn't exist.
   */
  async archiveOutputFiles(workflow: WorkflowIdentity, runId: string): Promise<Buffer | null> {
    const bareRepoPath = bareRepoPathFor(this.dataDir, workflow);
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['archive', '--format=zip', '--prefix=output/', runBranchName(runId), '--', OUTPUT_FILES_PATH_PREFIX],
        { cwd: bareRepoPath, encoding: 'buffer', maxBuffer: gitMaxBuffer() },
      );
      return stdout;
    } catch {
      return null;
    }
  }

  async readOutputFile(workflow: WorkflowIdentity, runId: string, path: string): Promise<Buffer | null> {
    assertOutputFilePath(path);
    const bareRepoPath = bareRepoPathFor(this.dataDir, workflow);
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['cat-file', 'blob', `${runBranchName(runId)}:${path}`],
        { cwd: bareRepoPath, encoding: 'buffer', maxBuffer: gitMaxBuffer() },
      );
      return stdout;
    } catch {
      return null;
    }
  }
}
