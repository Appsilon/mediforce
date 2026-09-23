import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DockerSpawnRequest } from '../docker-spawn-strategy';
import { runCodeCheck } from '../code-check';

const spawnedRequests: Array<{ request: DockerSpawnRequest; outputFiles: string[] }> = [];

vi.mock('../docker-spawn-strategy', () => ({
  getDockerSpawnStrategy: () => ({
    spawn: async (request: DockerSpawnRequest) => {
      spawnedRequests.push({ request, outputFiles: await readdir(request.outputDir) });
      await writeFile(join(request.outputDir, 'result.json'), JSON.stringify({ passed: true }));
      return { stdout: '', stderr: '', exitCode: 0, signal: null };
    },
  }),
}));

// Local mode (ALLOW_LOCAL_AGENTS) — the path dev and the L3 suite take; the
// Docker path is the script-container spawn, covered by its own L5 tests.
describe('runCodeCheck (local mode)', () => {
  let root: string;
  let bareRepoPath: string;
  let commit: string;
  let previousAllowLocal: string | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'code-check-test-'));
    const worktree = join(root, 'work');
    bareRepoPath = join(root, 'repo.git');
    execFileSync('git', ['init', '-q', '-b', 'main', worktree]);
    await writeFile(join(worktree, 'adae.csv'), 'USUBJID,AETERM,AETOXGR\n01-701-1015,SEPSIS,5\n');
    execFileSync('git', ['-C', worktree, 'add', '-A']);
    execFileSync('git', ['-C', worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'step output']);
    commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    execFileSync('git', ['clone', '-q', '--bare', worktree, bareRepoPath]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
  });

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  it('reads the result, trajectory and the step\'s workspace files, and returns its verdict', async () => {
    const source = [
      'import json',
      "data = json.load(open('/output/input.json'))",
      "rows = open('/workspace/adae.csv').read().strip().splitlines()[1:]",
      "fatal = [row for row in rows if row.split(',')[2] == '5']",
      "flagged = data['result'].get('grade5Flagged') is True",
      "used_tools = len(data['trajectory']) > 0",
      "json.dump({'passed': flagged == (len(fatal) > 0) and used_tools, 'comment': f'{len(fatal)} grade 5 row(s)'}, open('/output/result.json', 'w'))",
    ].join('\n');

    const outcome = await runCodeCheck({
      runtime: 'python',
      source,
      input: { result: { grade5Flagged: true }, trajectory: [{ type: 'tool_call', tool: 'Read' }], case: null },
      workspace: { bareRepoPath, commit },
      timeoutMs: 30_000,
      label: 'test',
    });

    expect(outcome).toEqual({ passed: true, comment: '1 grade 5 row(s)' });
  });

  it('runs javascript checks with an empty workspace', async () => {
    const source = [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const input = JSON.parse(readFileSync('/output/input.json', 'utf-8'));",
      "writeFileSync('/output/result.json', JSON.stringify({ passed: Array.isArray(input.result.findings) }));",
    ].join('\n');

    const outcome = await runCodeCheck({
      runtime: 'javascript',
      source,
      input: { result: { findings: 'none' }, trajectory: [], case: null },
      workspace: null,
      timeoutMs: 30_000,
      label: 'test',
    });

    expect(outcome).toEqual({ passed: false, comment: null });
  });

  it('throws when the check crashes, rather than scoring the output as failed', async () => {
    await expect(runCodeCheck({
      runtime: 'python',
      source: "raise RuntimeError('rubric file missing')",
      input: { result: {} },
      workspace: null,
      timeoutMs: 30_000,
      label: 'test',
    })).rejects.toThrow(/code check failed: .*rubric file missing/s);
  });

  it('throws when the check writes a result of the wrong shape', async () => {
    await expect(runCodeCheck({
      runtime: 'python',
      source: "import json\njson.dump({'score': 1}, open('/output/result.json', 'w'))",
      input: { result: {} },
      workspace: null,
      timeoutMs: 30_000,
      label: 'test',
    })).rejects.toThrow('code check result.json must be { "passed": boolean, "comment"?: string }');
  });
});

describe('runCodeCheck (container)', () => {
  let root: string;
  let bareRepoPath: string;
  let commit: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'code-check-container-test-'));
    const worktree = join(root, 'work');
    bareRepoPath = join(root, 'repo.git');
    execFileSync('git', ['init', '-q', '-b', 'main', worktree]);
    await writeFile(join(worktree, 'adae.csv'), 'USUBJID,AETERM,AETOXGR\n01-701-1015,SEPSIS,5\n');
    execFileSync('git', ['-C', worktree, 'add', '-A']);
    execFileSync('git', ['-C', worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'step output']);
    commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    execFileSync('git', ['clone', '-q', '--bare', worktree, bareRepoPath]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    spawnedRequests.length = 0;
  });

  const check = () => runCodeCheck({
    runtime: 'python',
    source: 'pass',
    input: { result: {} },
    workspace: { bareRepoPath, commit },
    timeoutMs: 30_000,
    label: 'agent-run-1',
  });

  it('keeps the workspace out of the output directory, which the queued strategy ships through Redis', async () => {
    await check();
    const [{ request, outputFiles }] = spawnedRequests;
    expect(outputFiles.sort()).toEqual(['check.py', 'input.json']);
    const workspaceMount = request.dockerArgs.find((arg) => arg.endsWith(':/workspace:ro'));
    expect(workspaceMount).toBeDefined();
    expect(workspaceMount!.startsWith(request.outputDir)).toBe(false);
  });

  it('runs unapproved code without capabilities, privilege escalation or unbounded processes', async () => {
    await check();
    const args = spawnedRequests[0]!.request.dockerArgs.join(' ');
    expect(args).toContain('--network none');
    expect(args).toContain('--cap-drop ALL');
    expect(args).toContain('--security-opt no-new-privileges');
    expect(args).toMatch(/--pids-limit \d+/);
  });

  it('names each container uniquely, so two checks of one run do not collide', async () => {
    await Promise.all([check(), check()]);
    const [first, second] = spawnedRequests.map((spawned) => spawned.request.containerName);
    expect(first).not.toBe(second);
  });
});
