import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TEST_ORG_HANDLE } from './constants';

/**
 * Seed Output Files into a run's bare repo, exactly as the real runtime lays
 * them out (bare repo `<MEDIFORCE_DATA_DIR>/bare-repos/<ns>/<wd>.git`, branch
 * `run/<runId>`, files under `.mediforce/output/<stepId>/`).
 *
 * Why seed with git directly: E2E runs under MOCK_AGENT=true swap in the mock
 * plugin, which only emits a result envelope — the workspace/commit machinery
 * lives in the container plugins (Docker), so the mock path never commits
 * anything under `.mediforce/output/`. This writes the same layout the reader
 * (`WorkspaceReader`) and the download route expect.
 *
 * Shared by the Output Files API E2E and the preview UI journey.
 */

// Must match the server's MEDIFORCE_DATA_DIR (playwright.config.ts webServer command).
export const SERVER_DATA_DIR = '/tmp/mediforce-e2e-data';

// Neutralize host-level git config (e.g. enforced commit signing) — the seed
// commits are test fixtures, not provenance-bearing artifacts.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<void> {
  await execFileAsync('git', args, { cwd, env: GIT_ENV });
}

export async function seedOutputFiles(
  workflowName: string,
  runId: string,
  filesByStep: Record<string, Record<string, Buffer | string>>,
): Promise<void> {
  const bareRepoPath = join(SERVER_DATA_DIR, 'bare-repos', TEST_ORG_HANDLE, `${workflowName}.git`);
  await mkdir(dirname(bareRepoPath), { recursive: true });
  await git(['init', '--bare', bareRepoPath]);

  const workDir = await mkdtemp(join(tmpdir(), 'output-files-seed-'));
  try {
    await git(['init'], workDir);
    for (const [stepId, files] of Object.entries(filesByStep)) {
      for (const [name, content] of Object.entries(files)) {
        const destination = join(workDir, '.mediforce', 'output', stepId, name);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }
    }
    await git(['add', '-A'], workDir);
    await git(
      [
        '-c', 'user.name=e2e',
        '-c', 'user.email=e2e@example.com',
        '-c', 'commit.gpgsign=false',
        'commit', '-m', `Seed Output Files for ${runId}`,
      ],
      workDir,
    );
    await git(['push', bareRepoPath, `HEAD:refs/heads/run/${runId}`], workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
