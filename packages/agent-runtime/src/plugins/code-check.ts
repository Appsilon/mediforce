import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { isLocalExecutionAllowed } from './base-container-agent-plugin';
import { getDockerSpawnStrategy } from './docker-spawn-strategy';
import { RUNTIME_CONFIG } from './script-container-plugin';

const execFileAsync = promisify(execFile);

export interface CodeCheckRequest {
  readonly runtime: 'python' | 'javascript';
  readonly source: string;
  /** Written to `/output/input.json`. */
  readonly input: Record<string, unknown>;
  /** The commit whose tree the check sees read-only at `/workspace`; null for an empty one. */
  readonly workspace: { readonly bareRepoPath: string; readonly commit: string } | null;
  readonly timeoutMs: number;
  /** Names the container, for `docker ps` and logs. */
  readonly label: string;
}

const CodeCheckResultSchema = z.object({
  passed: z.boolean(),
  comment: z.string().optional(),
});

export interface CodeCheckOutcome {
  readonly passed: boolean;
  readonly comment: string | null;
}

/**
 * Runs a `code` Evaluator (ADR-0023 D3) in the `script-container` sandbox: the
 * same runtime images, the same spawn strategy, no network, the step's
 * workspace commit read-only. A check that crashes, times out or writes no
 * valid `/output/result.json` throws — that is a broken check, not a failed
 * output, and must never be scored as one.
 */
export async function runCodeCheck(request: CodeCheckRequest): Promise<CodeCheckOutcome> {
  const runtime = RUNTIME_CONFIG[request.runtime]!;
  const outputDir = await realpath(await mkdtemp(join(tmpdir(), 'mediforce-code-check-')));
  // Beside the output directory, never inside it: the queued spawn strategy
  // ships all of `outputDir` through Redis, and a step's workspace can be large.
  // Both live under the shared temp directory, so the worker mounts it as is.
  const workspaceDir = await realpath(await mkdtemp(join(tmpdir(), 'mediforce-code-check-workspace-')));
  try {
    await writeFile(join(outputDir, 'input.json'), JSON.stringify(request.input, null, 2), 'utf-8');
    if (request.workspace !== null) {
      await exportCommit(request.workspace.bareRepoPath, request.workspace.commit, workspaceDir);
    }

    const exitCode = isLocalExecutionAllowed()
      ? await runLocally(request, runtime, outputDir, workspaceDir)
      : await runInContainer(request, runtime, outputDir, workspaceDir);
    if (exitCode !== 0) throw new Error(`code check exited with code ${String(exitCode)}`);

    let raw: string;
    try {
      raw = await readFile(join(outputDir, 'result.json'), 'utf-8');
    } catch {
      throw new Error('code check wrote no /output/result.json');
    }
    const parsed = CodeCheckResultSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error('code check result.json must be { "passed": boolean, "comment"?: string }');
    }
    return { passed: parsed.data.passed, comment: parsed.data.comment ?? null };
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The commit's tree as plain files — no worktree, so nothing is left in the bare repo. */
async function exportCommit(bareRepoPath: string, commit: string, targetDir: string): Promise<void> {
  const archive = `${targetDir}.tar`;
  await execFileAsync('git', ['--git-dir', bareRepoPath, 'archive', '--format=tar', '-o', archive, commit]);
  await execFileAsync('tar', ['-xf', archive, '-C', targetDir]);
  await rm(archive, { force: true });
}

type Runtime = (typeof RUNTIME_CONFIG)[string];

async function runLocally(
  request: CodeCheckRequest,
  runtime: Runtime,
  outputDir: string,
  workspaceDir: string,
): Promise<number> {
  // Dev only (ALLOW_LOCAL_AGENTS), mirroring script-container's local mode:
  // the container paths are rewritten to the host directories.
  const source = request.source.replaceAll('/output/', `${outputDir}/`).replaceAll('/workspace/', `${workspaceDir}/`);
  const scriptPath = join(outputDir, `check${runtime.ext}`);
  await writeFile(scriptPath, source, 'utf-8');
  const [command, ...args] = runtime.cmd(scriptPath);
  try {
    await execFileAsync(command!, args, {
      cwd: workspaceDir,
      timeout: request.timeoutMs,
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    });
    return 0;
  } catch (err) {
    const failure = err as { code?: number | string; stderr?: string };
    const detail = typeof failure.stderr === 'string' && failure.stderr.trim().length > 0
      ? `: ${failure.stderr.trim().slice(0, 2000)}`
      : '';
    throw new Error(`code check failed${detail}`);
  }
}

async function runInContainer(
  request: CodeCheckRequest,
  runtime: Runtime,
  outputDir: string,
  workspaceDir: string,
): Promise<number | null> {
  await writeFile(join(outputDir, `check${runtime.ext}`), request.source, 'utf-8');
  // Unique per check: the same run can be previewed and calibrated at once, and
  // the local strategy removes any container already holding the name.
  const containerName = `mediforce-code-check-${request.label}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 50)
    + `-${randomUUID().slice(0, 12)}`;
  const result = await getDockerSpawnStrategy().spawn({
    dockerArgs: [
      'run', '--rm',
      '--name', containerName,
      '--network', 'none',
      // DAC_OVERRIDE is the one capability kept: `mkdtemp` directories are 0700
      // and owned by whoever runs the platform, not by the container's root.
      '--cap-drop', 'ALL',
      '--cap-add', 'DAC_OVERRIDE',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '256',
      '--memory', '2g',
      '--cpus', '1',
      '-v', `${outputDir}:/output`,
      '-v', `${workspaceDir}:/workspace:ro`,
      '-w', '/workspace',
      runtime.image,
      ...runtime.cmd(`/output/check${runtime.ext}`),
    ],
    stdinPayload: null,
    timeoutMs: request.timeoutMs,
    containerName,
    processInstanceId: request.label,
    stepId: 'code-check',
    outputDir,
  });
  if (result.exitCode !== 0 && result.stderr.trim().length > 0) {
    throw new Error(`code check failed: ${result.stderr.trim().slice(0, 2000)}`);
  }
  return result.exitCode;
}
