/**
 * Integration test for the Claude Code plugin ↔ WorkspaceManager wiring.
 *
 * Exercises the real `run()` → `resolveRunWorkspace()` → `spawnLocalProcess()` →
 * `commitRunWorkspace()` path. The CLI command is swapped for a harmless shell
 * that writes a file and emits a synthetic stream-json result, so the plugin's
 * plumbing (prompt file, output dir, commit, git-result.json) actually runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';
import type { EmitPayload, EmitFn, WorkflowAgentContext } from '../../interfaces/agent-plugin.js';
import type { AgentCommandSpec } from '../base-container-agent-plugin.js';

type GetAgentCommandTarget = { getAgentCommand: (promptPath: string, options?: unknown) => AgentCommandSpec };
type ReadSkillTarget = { readSkillFile: (skillsDir: string, skill: string) => Promise<string> };

function buildWorkflowContext(overrides: Partial<WorkflowAgentContext> = {}): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: 'extract',
    name: 'Extract Step',
    type: 'creation',
    executor: 'agent',
    plugin: 'claude-code-agent',
    agent: {
      skill: 'some-skill',
      // No skillsDir: skips `--plugin-dir` wiring (no plugin manifest in tests).
      // No image: triggers local mode (ALLOW_LOCAL_AGENTS=true required).
    },
  };

  const workflowDefinition: WorkflowDefinition = {
    name: `wd-workspace-${Math.random().toString(36).slice(2, 8)}`,
    namespace: '_default',
    version: 1,
    steps: [step],
    transitions: [],
    triggers: [{ type: 'manual', name: 'start' }],
    workspace: {},
  };

  return {
    stepId: 'extract',
    processInstanceId: `pi-${Date.now().toString()}-${Math.random().toString(36).slice(2, 6)}`,
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
 * Build a shell command that acts as the mock agent: writes `bodyCommand` in the
 * worktree, then emits a synthetic stream-json result line on stdout.
 * Plugin runs this via its real `spawn` path, so `commitRunWorkspace` fires after.
 */
function mockAgentShellCommand(writeScript: string): AgentCommandSpec {
  const resultPayload = JSON.stringify({ ok: true });
  const streamLine = JSON.stringify({ type: 'result', subtype: 'success', result: resultPayload });
  // `cat > /dev/null` drains stdin before the shell exits. Without it the shell
  // finishes before the plugin finishes writing the prompt, and the plugin's
  // `stdin.end()` lands on a closed pipe — an unhandled EPIPE that vitest
  // surfaces as an "unhandled error" even though the test passed. Draining
  // stdin keeps the shell alive until the plugin's write completes.
  return {
    args: ['sh', '-c', `cat > /dev/null; ${writeScript}; echo '${streamLine}'`],
    promptDelivery: 'stdin',
  };
}

describe('ClaudeCodeAgentPlugin ↔ WorkspaceManager integration', () => {
  let dataDir: string;
  const originalAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
  const originalDataDir = process.env.MEDIFORCE_DATA_DIR;

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
  });

  it('creates a worktree, commits the step output, and writes git-result.json', async () => {
    const plugin = new ClaudeCodeAgentPlugin();
    const context = buildWorkflowContext();
    await plugin.initialize(context);
    vi.spyOn(plugin as unknown as ReadSkillTarget, 'readSkillFile').mockResolvedValue('# Skill');
    vi.spyOn(plugin as unknown as GetAgentCommandTarget, 'getAgentCommand').mockReturnValue(
      mockAgentShellCommand('echo "# extracted" > report.md'),
    );

    const { emit } = buildEmitSpy();
    await plugin.run(emit);

    const name = context.workflowDefinition.name;
    const wtDir = join(dataDir, 'worktrees', '_default', name, context.processInstanceId);
    const log = execFileSync('git', ['log', '--oneline'], { cwd: wtDir, encoding: 'utf-8' });
    // 2 commits: initial .gitignore seed on main + this step's commit
    expect(log.split('\n').filter(Boolean).length).toBe(2);
    expect(log).toMatch(/Extract Step/);

    // The run branch exists in the bare repo and carries the committed file
    const bareRepoPath = join(dataDir, 'bare-repos', '_default', `${name}.git`);
    const branches = execFileSync('git', ['--git-dir', bareRepoPath, 'branch', '--list'], { encoding: 'utf-8' });
    expect(branches).toContain(`run/${context.processInstanceId}`);
    const report = await readFile(join(wtDir, 'report.md'), 'utf-8');
    expect(report.trim()).toBe('# extracted');
  });

  it('commits an empty audit marker when the agent writes no files (Step-Status: success, no changes)', async () => {
    const plugin = new ClaudeCodeAgentPlugin();
    const context = buildWorkflowContext();
    await plugin.initialize(context);
    vi.spyOn(plugin as unknown as ReadSkillTarget, 'readSkillFile').mockResolvedValue('# Skill');
    vi.spyOn(plugin as unknown as GetAgentCommandTarget, 'getAgentCommand').mockReturnValue(
      mockAgentShellCommand('true'), // no file writes
    );

    const { emit } = buildEmitSpy();
    await plugin.run(emit);

    const name = context.workflowDefinition.name;
    const bareRepoPath = join(dataDir, 'bare-repos', '_default', `${name}.git`);
    const mainSha = execFileSync('git', ['--git-dir', bareRepoPath, 'rev-parse', 'refs/heads/main'], { encoding: 'utf-8' }).trim();
    const runSha = execFileSync('git', ['--git-dir', bareRepoPath, 'rev-parse', `refs/heads/run/${context.processInstanceId}`], { encoding: 'utf-8' }).trim();

    // The run branch advances even with no changes — full audit trail.
    expect(runSha).not.toBe(mainSha);

    const body = execFileSync(
      'git', ['--git-dir', bareRepoPath, 'log', '-1', '--format=%B', `refs/heads/run/${context.processInstanceId}`],
      { encoding: 'utf-8' },
    );
    expect(body.split('\n')[0]).toMatch(/— no changes$/);
    expect(body).toMatch(/Step-Status: success/);
  });

  it('step 2 of the same run reattaches to the worktree and sees step 1 commits', async () => {
    // --- Step 1 ---
    const context1 = buildWorkflowContext();
    const plugin1 = new ClaudeCodeAgentPlugin();
    await plugin1.initialize(context1);
    vi.spyOn(plugin1 as unknown as ReadSkillTarget, 'readSkillFile').mockResolvedValue('# Skill');
    vi.spyOn(plugin1 as unknown as GetAgentCommandTarget, 'getAgentCommand').mockReturnValue(
      mockAgentShellCommand('echo "step 1 content" > foo.txt'),
    );
    await plugin1.run(buildEmitSpy().emit);

    // --- Step 2: same run, different step id — must re-use the same worktree ---
    const context2: WorkflowAgentContext = {
      ...context1,
      stepId: 'refine',
      step: { ...context1.step, id: 'refine' },
    };
    const plugin2 = new ClaudeCodeAgentPlugin();
    await plugin2.initialize(context2);
    vi.spyOn(plugin2 as unknown as ReadSkillTarget, 'readSkillFile').mockResolvedValue('# Skill');
    // Assert inside the shell command that foo.txt exists — if step 2 got a fresh
    // worktree without step 1's commits, the file wouldn't be there and the exit
    // code would flip to non-zero, failing the test.
    vi.spyOn(plugin2 as unknown as GetAgentCommandTarget, 'getAgentCommand').mockReturnValue(
      mockAgentShellCommand('test -f foo.txt && echo "step 2 content" > bar.txt'),
    );
    await plugin2.run(buildEmitSpy().emit);

    const name = context1.workflowDefinition.name;
    const wtDir = join(dataDir, 'worktrees', '_default', name, context1.processInstanceId);
    const log = execFileSync('git', ['log', '--oneline'], { cwd: wtDir, encoding: 'utf-8' });
    // 3 commits: gitignore seed + step 1 + step 2
    expect(log.split('\n').filter(Boolean).length).toBe(3);
    expect(await readFile(join(wtDir, 'foo.txt'), 'utf-8')).toBe('step 1 content\n');
    expect(await readFile(join(wtDir, 'bar.txt'), 'utf-8')).toBe('step 2 content\n');
  });
});
