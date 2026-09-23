import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodeCheck } from '../code-check';

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
