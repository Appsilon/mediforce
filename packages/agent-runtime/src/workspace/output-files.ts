/**
 * Output Files — copy a step's `/output` deliverables into the run worktree
 * under `.mediforce/output/<stepId>/` so the per-step commit captures them.
 *
 * The `/output` dir is an ephemeral host↔container I/O channel (deleted after
 * every step). Anything the agent leaves there besides the engine-owned
 * control files becomes a durable Output File on the run branch.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Engine-owned control files that must never become Output Files. Shared with
 * `persistDeliverableFile`, which additionally excludes the presentation
 * files — derive from these constants so the two lists cannot drift apart.
 */
export const INTERNAL_OUTPUT_FILE_NAMES: ReadonlySet<string> = new Set([
  'auth.json',
  'prompt.txt',
  'result.json',
  'git-result.json',
  'mock-result.json',
  'opencode.json',
  'input.json',
  'previous_run.json',
  'mcp-config.json',
  // Inline-script payloads seeded by ScriptContainerPlugin — one per
  // RUNTIME_CONFIG extension (script-container-plugin.ts).
  'script.mjs',
  'script.py',
  'script.R',
  'script.sh',
]);

/** Presentation files — already surfaced via spawnResult.presentation, but
 *  still copied as Output Files (product decision). Markdown first: order
 *  matters for the persistDeliverableFile fallback. */
export const PRESENTATION_FILE_NAMES: readonly string[] = ['presentation.md', 'presentation.html'];

/** Repo-relative root under which Output Files live on the run branch. */
export const OUTPUT_FILES_REPO_ROOT = '.mediforce/output';

export const DEFAULT_OUTPUT_FILE_MAX_BYTES = 100 * 1024 * 1024;

export function resolveOutputFileMaxBytes(): number {
  const raw = process.env.MEDIFORCE_OUTPUT_FILE_MAX_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_OUTPUT_FILE_MAX_BYTES;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) === false || parsed <= 0) return DEFAULT_OUTPUT_FILE_MAX_BYTES;
  return parsed;
}

interface PendingCopy {
  sourcePath: string;
  relativePath: string;
}

async function collectCopyableFile(
  sourcePath: string,
  relativePath: string,
  maxBytes: number,
  pending: PendingCopy[],
): Promise<void> {
  const info = await stat(sourcePath);
  if (info.isFile() === false) return;
  if (info.size > maxBytes) {
    console.warn(
      `[output-files] Skipping ${relativePath} (${info.size} bytes) — exceeds the ` +
      `MEDIFORCE_OUTPUT_FILE_MAX_BYTES cap of ${maxBytes} bytes`,
    );
    return;
  }
  pending.push({ sourcePath, relativePath });
}

async function collectDirectory(
  dir: string,
  relativePrefix: string,
  maxBytes: number,
  pending: PendingCopy[],
): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const sourcePath = join(dir, entry.name);
    const relativePath = join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      await collectDirectory(sourcePath, relativePath, maxBytes, pending);
    } else if (entry.isFile()) {
      await collectCopyableFile(sourcePath, relativePath, maxBytes, pending);
    }
  }
}

/**
 * Copy the step's Output Files from `outputDir` into
 * `<worktreePath>/.mediforce/output/<stepId>/`.
 *
 * - Internal runtime files and dotfiles are skipped at the top level only;
 *   nested directories are copied recursively as-is.
 * - Files over the per-file size cap (`MEDIFORCE_OUTPUT_FILE_MAX_BYTES`,
 *   default 100 MiB) are skipped with a warning.
 * - Best-effort: never throws — a copy failure must not fail the step commit.
 * - Creates no directory when there is nothing to copy.
 */
export async function copyOutputFilesIntoWorkspace(
  outputDir: string,
  worktreePath: string,
  stepId: string,
): Promise<void> {
  try {
    let topLevelEntries;
    try {
      topLevelEntries = await readdir(outputDir, { withFileTypes: true });
    } catch {
      return;
    }

    const maxBytes = resolveOutputFileMaxBytes();
    const pending: PendingCopy[] = [];

    for (const entry of topLevelEntries) {
      if (entry.name.startsWith('.')) continue;
      if (INTERNAL_OUTPUT_FILE_NAMES.has(entry.name)) continue;
      const sourcePath = join(outputDir, entry.name);
      if (entry.isDirectory()) {
        await collectDirectory(sourcePath, entry.name, maxBytes, pending);
      } else if (entry.isFile()) {
        await collectCopyableFile(sourcePath, entry.name, maxBytes, pending);
      }
    }

    if (pending.length === 0) return;

    const destRoot = join(worktreePath, OUTPUT_FILES_REPO_ROOT, stepId);
    for (const { sourcePath, relativePath } of pending) {
      try {
        const destPath = join(destRoot, relativePath);
        await mkdir(dirname(destPath), { recursive: true });
        await copyFile(sourcePath, destPath);
      } catch (copyError) {
        console.warn(`[output-files] Failed to copy ${relativePath} into the workspace:`, copyError);
      }
    }
  } catch (collectError) {
    console.warn('[output-files] Failed to copy output files into the workspace:', collectError);
  }
}
