/**
 * Output Files — a step's output folder is `.mediforce/output/<stepId>/` in
 * the run worktree, bind-mounted at `/output` (ADR-0030). The step writes
 * `result.json` and its Output Files straight into it, and the step commit
 * captures them: nothing is copied and nothing is deleted after the step.
 */
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, type Presentation } from '@mediforce/platform-core';

/** Repo-relative root under which Output Files live on the run branch. */
export const OUTPUT_FILES_REPO_ROOT = '.mediforce/output';

/** The step's result. Committed with the folder, but not an Output File. */
export const RESULT_FILE_NAME = 'result.json';

/** Split a repo path `.mediforce/output/<stepId>/<name>` into its step and
 *  step-relative name; null for any other path. */
export function parseOutputFilePath(repoPath: string): { stepId: string; name: string } | null {
  const prefix = `${OUTPUT_FILES_REPO_ROOT}/`;
  if (repoPath.startsWith(prefix) === false) return null;
  const stepRelativePath = repoPath.slice(prefix.length);
  const slashIndex = stepRelativePath.indexOf('/');
  if (slashIndex <= 0 || slashIndex === stepRelativePath.length - 1) return null;
  return { stepId: stepRelativePath.slice(0, slashIndex), name: stepRelativePath.slice(slashIndex + 1) };
}

/** Inputs the engine seeds into the output folder, where every script and
 *  skill has always read them (`/output/input.json`). Removed before the step
 *  commit, so they never become Output Files. */
const SEEDED_INPUT_FILE_NAMES: readonly string[] = ['input.json', 'previous_run.json'];

/** Presentation files — surfaced via the envelope's `presentation`, and still
 *  Output Files (product decision). Markdown first: order matters for the
 *  persistDeliverableFile fallback. */
export const PRESENTATION_FILE_NAMES: readonly string[] = ['presentation.md', 'presentation.html'];

export const DEFAULT_OUTPUT_FILE_MAX_BYTES = 100 * 1024 * 1024;

export function resolveOutputFileMaxBytes(): number {
  const raw = process.env.MEDIFORCE_OUTPUT_FILE_MAX_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_OUTPUT_FILE_MAX_BYTES;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) === false || parsed <= 0) return DEFAULT_OUTPUT_FILE_MAX_BYTES;
  return parsed;
}

/** Host path of a step's output folder in the run worktree. */
function stepOutputDirPath(worktreePath: string, stepId: string): string {
  return join(worktreePath, OUTPUT_FILES_REPO_ROOT, stepId);
}

/**
 * Empty the step's output folder (creating it when missing), so a step that
 * runs again — a loop, a retry — never inherits files from its earlier
 * execution. Those files stay in git history.
 */
export async function resetStepOutputDir(worktreePath: string, stepId: string): Promise<string> {
  const dir = stepOutputDirPath(worktreePath, stepId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

async function removeOversizedFiles(dir: string, relativePrefix: string, maxBytes: number): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const relativePath = join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      await removeOversizedFiles(path, relativePath, maxBytes);
      continue;
    }
    if (entry.isFile() === false) continue;
    const { size } = await stat(path);
    if (size <= maxBytes) continue;
    console.warn(
      `[output-files] Not committing ${relativePath} (${size} bytes) — exceeds the ` +
      `MEDIFORCE_OUTPUT_FILE_MAX_BYTES cap of ${maxBytes} bytes`,
    );
    await rm(path, { force: true });
  }
}

/**
 * Make the step's output folder ready for the step commit: remove the inputs
 * the engine seeded, top-level dotfiles (tool state such as `.Rhistory` or
 * `.cache/`, never an Output File), and every file over the per-file size cap
 * (`MEDIFORCE_OUTPUT_FILE_MAX_BYTES`, default 100 MiB), logging each.
 * Best-effort: never throws — a cleanup failure must not fail the step commit.
 */
export async function prepareStepOutputDirForCommit(stepOutputDir: string): Promise<void> {
  try {
    for (const name of SEEDED_INPUT_FILE_NAMES) {
      await rm(join(stepOutputDir, name), { force: true });
    }
    for (const name of await readdir(stepOutputDir)) {
      if (name.startsWith('.')) await rm(join(stepOutputDir, name), { recursive: true, force: true });
    }
    await removeOversizedFiles(stepOutputDir, '', resolveOutputFileMaxBytes());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.warn('[output-files] Failed to prepare the output folder for the step commit:', error);
  }
}

/** The step's result: `result.json` in its output folder, one JSON object.
 *  Throws when it is missing, invalid JSON, or not an object (ADR-0030). */
export async function readStepResult(stepOutputDir: string): Promise<Record<string, unknown>> {
  let contents: string;
  try {
    contents = await readFile(join(stepOutputDir, RESULT_FILE_NAME), 'utf-8');
  } catch {
    throw new Error(`agent wrote no ${RESULT_FILE_NAME}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${RESULT_FILE_NAME} is not valid JSON`);
  }
  if (isRecord(parsed) === false) throw new Error(`${RESULT_FILE_NAME} is not a JSON object`);
  return parsed;
}

/** Read presentation.md (preferred) or presentation.html from the step's
 *  output folder. Returns null when neither file exists. Markdown wins on
 *  tie — agents that want the iframe path must omit the .md file. */
export async function readPresentation(stepOutputDir: string): Promise<Presentation | null> {
  try {
    return {
      kind: 'markdown',
      content: await readFile(join(stepOutputDir, 'presentation.md'), 'utf-8'),
    };
  } catch {
    try {
      return {
        kind: 'html',
        content: await readFile(join(stepOutputDir, 'presentation.html'), 'utf-8'),
      };
    } catch {
      return null;
    }
  }
}
