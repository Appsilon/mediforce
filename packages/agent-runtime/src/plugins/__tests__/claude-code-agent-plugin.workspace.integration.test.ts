/**
 * Integration test for the Claude Code plugin ↔ WorkspaceManager wiring.
 *
 * Exercises the real `run()` → `resolveRunWorkspace()` → `spawnLocalProcess()` →
 * `commitRunWorkspace()` path. The CLI command is swapped for a harmless shell
 * that writes files and emits a synthetic stream-json result, so the plugin's
 * plumbing (engine dir, step output folder, commit) actually runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin';
import type { EmitPayload, EmitFn, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import type { AgentCommandSpec } from '../base-container-agent-plugin';

type GetAgentCommandTarget = { getAgentCommand: (promptPath: string, options?: unknown) => AgentCommandSpec };

function buildWorkflowContext(overrides: Partial<WorkflowAgentContext> = {}): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: 'extract',
    name: 'Extract Step',
    type: 'creation',
    executor: 'agent',
    plugin: 'claude-code-agent',
    agent: {
      prompt: 'Extract the data',
      // No image: triggers local mode (ALLOW_LOCAL_AGENTS=true required).
    },
  };

  const workflowDefinition: WorkflowDefinition = {
    name: `wd-workspace-${Math.random().toString(36).slice(2, 8)}`,
    namespace: '_default',
    version: 1,
    visibility: 'private',
    steps: [step],
    transitions: [],
    workspace: {},
  };

  return {
    stepId: 'extract',
    processInstanceId: `pi-${Date.now().toString()}-${Math.random().toString(36).slice(2, 6)}`,
    runNamespace: 'test',
    definitionVersion: 'v1',
    stepInput: {},
    autonomyLevel: 'L4',
    workflowDefinition,
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function buildEmitSpy(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = vi.fn(async (event: EmitPayload) => {
    events.push(event);
  });
  return { emit, events };
}

/**
 * Build a shell command that acts as the mock agent: runs `writeScript` in the
 * worktree, writes `result.json` into the step's output folder (unless told
 * not to), then emits a synthetic stream-json result line on stdout.
 * Plugin runs this via its real `spawn` path, so `commitRunWorkspace` fires after.
 */
function mockAgentShellCommand(writeScript: string, stepId = 'extract', writesResult = true): AgentCommandSpec {
  const streamLine = JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.' });
  const writeResult = writesResult ? `echo '{"ok":true}' > .mediforce/output/${stepId}/result.json;` : '';
  // `cat > /dev/null` drains stdin before the shell exits. Without it the shell
  // finishes before the plugin finishes writing the prompt, and the plugin's
  // `stdin.end()` lands on a closed pipe — an unhandled EPIPE that vitest
  // surfaces as an "unhandled error" even though the test passed. Draining
  // stdin keeps the shell alive until the plugin's write completes.
  return {
    args: ['sh', '-c', `cat > /dev/null; ${writeScript}; ${writeResult} echo '${streamLine}'`],
    promptDelivery: 'stdin',
  };
}

function stepCommitFiles(wtDir: string, revision = 'HEAD'): string[] {
  return execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', revision], { cwd: wtDir, encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean).sort();
}

describe('ClaudeCodeAgentPlugin ↔ WorkspaceManager integration', () => {
  let dataDir: string;
  const originalAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
  const originalDataDir = process.env.MEDIFORCE_DATA_DIR;
  const originalMaxBytes = process.env.MEDIFORCE_OUTPUT_FILE_MAX_BYTES;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'wsmgr-integ-'));
    process.env.MEDIFORCE_DATA_DIR = dataDir;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    if (originalDataDir === undefined) delete process.env.MEDIFORCE_DATA_DIR;
    else process.env.MEDIFORCE_DATA_DIR = originalDataDir;
    if (originalAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = originalAllowLocal;
    if (originalMaxBytes === undefined) delete process.env.MEDIFORCE_OUTPUT_FILE_MAX_BYTES;
    else process.env.MEDIFORCE_OUTPUT_FILE_MAX_BYTES = originalMaxBytes;
    vi.restoreAllMocks();
  });

  function worktreeOf(context: WorkflowAgentContext): string {
    return join(dataDir, 'worktrees', '_default', context.workflowDefinition.name, context.processInstanceId);
  }

  async function runStep(context: WorkflowAgentContext, command: AgentCommandSpec): Promise<void> {
    const plugin = new ClaudeCodeAgentPlugin();
    await plugin.initialize(context);
    vi.spyOn(plugin as unknown as GetAgentCommandTarget, 'getAgentCommand').mockReturnValue(command);
    await plugin.run(buildEmitSpy().emit);
  }

  it('creates a worktree and commits the repository edit, result.json and the Output Files — never the engine\'s files', async () => {
    const context = buildWorkflowContext({ stepInput: { trial: 'CDISCPILOT01' } });

    await runStep(context, mockAgentShellCommand('echo "# extracted" > report.md; echo "a,b" > .mediforce/output/extract/listing.csv'));

    const wtDir = worktreeOf(context);
    const log = execFileSync('git', ['log', '--oneline'], { cwd: wtDir, encoding: 'utf-8' });
    // 2 commits: initial .gitignore seed on main + this step's commit
    expect(log.split('\n').filter(Boolean).length).toBe(2);
    expect(log).toMatch(/Extract Step/);
    expect(stepCommitFiles(wtDir)).toEqual([
      '.mediforce/output/extract/listing.csv',
      '.mediforce/output/extract/result.json',
      'report.md',
    ]);

    // The run branch exists in the bare repo and carries the committed file
    const bareRepoPath = join(dataDir, 'bare-repos', '_default', `${context.workflowDefinition.name}.git`);
    const branches = execFileSync('git', ['--git-dir', bareRepoPath, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).toContain(`run/${context.processInstanceId}`);
    expect((await readFile(join(wtDir, 'report.md'), 'utf-8')).trim()).toBe('# extracted');
  });

  it('fails a step whose agent wrote no result.json, and still commits what it left (✗)', async () => {
    const context = buildWorkflowContext();

    await expect(runStep(context, mockAgentShellCommand('echo "half" > .mediforce/output/extract/partial.md', 'extract', false)))
      .rejects.toThrow('agent wrote no result.json');

    const wtDir = worktreeOf(context);
    expect(stepCommitFiles(wtDir)).toEqual(['.mediforce/output/extract/partial.md']);
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: wtDir, encoding: 'utf-8' })).toContain('✗');
  });

  it('never commits an Output File over the size cap', async () => {
    process.env.MEDIFORCE_OUTPUT_FILE_MAX_BYTES = '64';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = buildWorkflowContext();

    await runStep(context, mockAgentShellCommand('head -c 200 /dev/zero > .mediforce/output/extract/dump.bin'));

    expect(stepCommitFiles(worktreeOf(context))).toEqual(['.mediforce/output/extract/result.json']);
  });

  it('never commits top-level dotfiles a tool leaves in the output folder', async () => {
    const context = buildWorkflowContext();

    await runStep(context, mockAgentShellCommand(
      'echo "history" > .mediforce/output/extract/.Rhistory && mkdir -p .mediforce/output/extract/.cache && echo "x" > .mediforce/output/extract/.cache/blob && echo "# t" > .mediforce/output/extract/table.md',
    ));

    expect(stepCommitFiles(worktreeOf(context)).sort()).toEqual([
      '.mediforce/output/extract/result.json',
      '.mediforce/output/extract/table.md',
    ]);
  });

  it('step 2 of the same run reattaches to the worktree and sees step 1 commits', async () => {
    const context1 = buildWorkflowContext();
    await runStep(context1, mockAgentShellCommand('echo "step 1 content" > foo.txt'));

    // Same run, different step id — must re-use the same worktree. The shell
    // asserts foo.txt exists: a fresh worktree would flip its exit code.
    const context2: WorkflowAgentContext = { ...context1, stepId: 'refine', step: { ...context1.step, id: 'refine' } };
    await runStep(context2, mockAgentShellCommand('test -f foo.txt && echo "step 2 content" > bar.txt', 'refine'));

    const wtDir = worktreeOf(context1);
    const log = execFileSync('git', ['log', '--oneline'], { cwd: wtDir, encoding: 'utf-8' });
    // 3 commits: gitignore seed + step 1 + step 2
    expect(log.split('\n').filter(Boolean).length).toBe(3);
    expect(await readFile(join(wtDir, 'foo.txt'), 'utf-8')).toBe('step 1 content\n');
    expect(await readFile(join(wtDir, 'bar.txt'), 'utf-8')).toBe('step 2 content\n');
  });

  it('empties the output folder when a step runs again, so it never inherits its earlier files', async () => {
    const context = buildWorkflowContext();
    await runStep(context, mockAgentShellCommand('echo "draft 1" > .mediforce/output/extract/draft-1.md'));

    // The shell fails the step if draft-1.md is still there.
    await runStep(context, mockAgentShellCommand('test ! -e .mediforce/output/extract/draft-1.md && echo "draft 2" > .mediforce/output/extract/draft-2.md'));

    const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', '.mediforce/output/extract/'], { cwd: worktreeOf(context), encoding: 'utf-8' });
    expect(tree.trim().split('\n').sort()).toEqual(['.mediforce/output/extract/draft-2.md', '.mediforce/output/extract/result.json']);
  });
});
