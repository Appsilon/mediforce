/**
 * Integration tests for WorkspaceManager against real local git repos.
 * No network, no SSH. Uses createTestRepo helper for "remote" bare repos.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceManager, formatFileDelta, formatStepCommitMessage } from '../workspace-manager.js';
import { createTestRepo, type TestRepo } from '../../plugins/__tests__/helpers/create-test-repo.js';
import type { WorkflowWorkspace } from '@mediforce/platform-core';

function listBareBranches(bareRepoPath: string): string[] {
  const out = execFileSync('git', ['--git-dir', bareRepoPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
    encoding: 'utf-8',
  });
  return out.trim().split('\n').filter(Boolean);
}

describe('WorkspaceManager', () => {
  let dataDir: string;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'wsmgr-data-'));
    manager = new WorkspaceManager({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('ensureBareRepo', () => {
    it('initializes a local-only bare repo with a seed main branch', async () => {
      const wd = { name: 'my-wd', workspace: {} as WorkflowWorkspace };
      const result = await manager.ensureBareRepo(wd);

      expect(result.freshlyInitialized).toBe(true);
      expect(result.remoteUrl).toBeNull();
      expect(listBareBranches(result.path)).toContain('main');
    });

    it('init+fetches from a remote path', async () => {
      const remote = createTestRepo();
      try {
        const wd = { name: 'wd-with-remote', workspace: { remote: remote.repoPath } as WorkflowWorkspace };
        const result = await manager.ensureBareRepo(wd);

        expect(result.freshlyInitialized).toBe(true);
        expect(result.remoteUrl).toBe(remote.repoPath);
        // The remote's tip is reachable via a remote-tracking ref. We use
        // init+fetch (multi-remote model), not git clone --bare.
        const remoteRefs = execFileSync('git', [
          '--git-dir', result.path, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/',
        ], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
        const mainRef = remoteRefs.find((line) => line.endsWith('/main ' + remote.commitSha) || line.includes('/main '));
        expect(mainRef).toBeDefined();
        expect(mainRef!.endsWith(remote.commitSha)).toBe(true);
      } finally {
        remote.cleanup();
      }
    });

    it('is idempotent on repeated calls (no throw, same path)', async () => {
      const wd = { name: 'wd-idem', workspace: {} as WorkflowWorkspace };
      const a = await manager.ensureBareRepo(wd);
      const b = await manager.ensureBareRepo(wd);
      expect(b.path).toBe(a.path);
      expect(b.freshlyInitialized).toBe(false);
    });
  });

  describe('createRunWorkspace', () => {
    it('creates a worktree on a run branch with configured identity', async () => {
      const wd = { name: 'wd-run', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-001');

      expect(ws.branch).toBe('run/run-001');
      expect(ws.startCommit).toMatch(/^[a-f0-9]{40}$/);

      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws.path, encoding: 'utf-8' }).trim();
      expect(branch).toBe('run/run-001');

      const email = execFileSync('git', ['config', 'user.email'], { cwd: ws.path, encoding: 'utf-8' }).trim();
      expect(email).toBe('agent@mediforce.dev');
    });

    it('is idempotent by (workflow, runId) — returns same worktree across calls', async () => {
      const wd = { name: 'wd-idem-run', workspace: {} as WorkflowWorkspace };
      const a = await manager.createRunWorkspace(wd, 'run-idem');

      // Write a file and commit so we can verify state persists
      await writeFile(join(a.path, 'marker.txt'), 'hello');
      await manager.commitStep(a, { stepId: 'step-1' });

      const b = await manager.createRunWorkspace(wd, 'run-idem');
      expect(b.path).toBe(a.path);
      // The marker from step 1 is still there — proving the worktree was reused
      const text = await readFile(join(b.path, 'marker.txt'), 'utf-8');
      expect(text).toBe('hello');
    });

    it('supports parallel runs on independent branches', async () => {
      const wd = { name: 'wd-parallel', workspace: {} as WorkflowWorkspace };
      const [r1, r2] = await Promise.all([
        manager.createRunWorkspace(wd, 'run-a'),
        manager.createRunWorkspace(wd, 'run-b'),
      ]);

      expect(r1.path).not.toBe(r2.path);
      expect(r1.branch).toBe('run/run-a');
      expect(r2.branch).toBe('run/run-b');
      // Both branches end up in the same bare repo
      expect(r1.bareRepoPath).toBe(r2.bareRepoPath);
      const branches = listBareBranches(r1.bareRepoPath);
      expect(branches).toEqual(expect.arrayContaining(['run/run-a', 'run/run-b']));
    });
  });

  describe('commitStep', () => {
    it('commits an empty commit (via --allow-empty) when there are no changes, for a full audit trail', async () => {
      const wd = { name: 'wd-nochange', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-nochange');
      const result = await manager.commitStep(ws, { stepId: 'step-1', stepName: 'No-op' });
      expect(result.isEmpty).toBe(true);
      expect(result.changedFiles).toEqual([]);
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

      // The run branch has one commit beyond the seed, with a "no changes" subject.
      const subjects = execFileSync('git', ['log', '--format=%s', '-n', '2'], { cwd: ws.path, encoding: 'utf-8' })
        .trim().split('\n');
      expect(subjects[0]).toBe('◆ No-op — no changes');
      expect(subjects[1]).toBe('◇ Initialize workspace repository');
    });

    it('commits staged changes and returns commit metadata', async () => {
      const wd = { name: 'wd-commit', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-commit');

      await writeFile(join(ws.path, 'note.md'), '# hello');
      await mkdir(join(ws.path, 'data'), { recursive: true });
      await writeFile(join(ws.path, 'data', 'out.json'), '{"ok":true}');

      const result = await manager.commitStep(ws, { stepId: 'step-write' });
      expect(result.isEmpty).toBe(false);
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
      expect(result.changedFiles.sort()).toEqual(['data/out.json', 'note.md'].sort());
    });

    it('accumulates commits across multiple steps on the same run branch', async () => {
      const wd = { name: 'wd-multi', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-multi');

      await writeFile(join(ws.path, 'a.txt'), 'step 1');
      const r1 = await manager.commitStep(ws, { stepId: 'step-1', stepName: 'One' });

      await writeFile(join(ws.path, 'b.txt'), 'step 2');
      const r2 = await manager.commitStep(ws, { stepId: 'step-2', stepName: 'Two' });

      expect(r1.commitSha).not.toBe(r2.commitSha);

      // git log should show both step commits above the seed
      const log = execFileSync('git', ['log', '--format=%s', '-n', '3'], { cwd: ws.path, encoding: 'utf-8' });
      expect(log).toMatch(/◆ Two/);
      expect(log).toMatch(/◆ One/);
    });

    it('cleans ignored files after commit so they do not leak into the next step', async () => {
      const wd = { name: 'wd-clean', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-clean');

      await writeFile(join(ws.path, 'report.md'), '# step 1');
      await writeFile(join(ws.path, 'leak.env'), 'API_KEY=secret');

      await manager.commitStep(ws, { stepId: 'step-1' });

      // Tracked file stays on disk (it was committed)
      const report = await readFile(join(ws.path, 'report.md'), 'utf-8');
      expect(report).toBe('# step 1');
      // Ignored file is wiped — next step sees a clean state
      await expect(readFile(join(ws.path, 'leak.env'), 'utf-8')).rejects.toThrow();
    });
  });

  describe('listRunWorktrees', () => {
    it('enumerates worktrees across namespaces and workflows', async () => {
      const wd1 = { name: 'wd-a', workspace: {} as WorkflowWorkspace };
      const wd2 = { name: 'wd-b', namespace: 'team', workspace: {} as WorkflowWorkspace };
      await manager.createRunWorkspace(wd1, 'run-1');
      await manager.createRunWorkspace(wd1, 'run-2');
      await manager.createRunWorkspace(wd2, 'run-3');

      const all = await manager.listRunWorktrees();
      const entries = all.map((e) => `${e.namespace}/${e.workflowName}/${e.runId}`).sort();
      expect(entries).toEqual(['_default/wd-a/run-1', '_default/wd-a/run-2', 'team/wd-b/run-3']);

      const wdAEntries = all.filter((e) => e.workflowName === 'wd-a');
      expect(wdAEntries[0].bareRepoPath).toBe(join(dataDir, 'bare-repos', '_default', 'wd-a.git'));
    });

    it('returns empty when there are no worktrees', async () => {
      expect(await manager.listRunWorktrees()).toEqual([]);
    });
  });

  describe('disposeRunWorkspace', () => {
    it('removes the worktree but keeps the branch in the bare repo', async () => {
      const wd = { name: 'wd-dispose', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-dispose');
      await writeFile(join(ws.path, 'x.txt'), 'x');
      await manager.commitStep(ws, { stepId: 'step-dispose' });

      await manager.disposeRunWorkspace(ws);

      // Worktree dir is gone
      await expect(readFile(join(ws.path, 'x.txt'), 'utf-8')).rejects.toThrow();

      // But the branch persists in the bare repo
      const branches = listBareBranches(ws.bareRepoPath);
      expect(branches).toContain('run/run-dispose');
    });
  });

  describe('secret defense', () => {
    describe('baseline ignore patterns', () => {
      it('bare repo carries exclude patterns covering common secret filenames', async () => {
        const wd = { name: 'wd-ignore', workspace: {} as WorkflowWorkspace };
        const bare = await manager.ensureBareRepo(wd);

        const exclude = await readFile(join(bare.path, 'info', 'exclude'), 'utf-8');
        // Spot-check the patterns the design doc calls out
        expect(exclude).toMatch(/\*\.env\b/);
        expect(exclude).toMatch(/\*\.pem\b/);
        expect(exclude).toMatch(/\*\.key\b/);
        expect(exclude).toMatch(/\*\.p12\b/);
        expect(exclude).toMatch(/id_rsa/);
        expect(exclude).toMatch(/credentials/);
        expect(exclude).toMatch(/\.secrets\//);
      });

      it('files matching the baseline patterns are not staged by commitStep', async () => {
        const wd = { name: 'wd-ignore-files', workspace: {} as WorkflowWorkspace };
        const ws = await manager.createRunWorkspace(wd, 'run-ignore-files');

        // Ignored files — should NOT end up in the commit
        await writeFile(join(ws.path, 'creds.env'), 'API_KEY=shouldnotleak');
        await writeFile(join(ws.path, 'server.pem'), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
        await mkdir(join(ws.path, '.secrets'), { recursive: true });
        await writeFile(join(ws.path, '.secrets', 'prod.json'), '{"x":1}');

        // A legitimate file — should be committed
        await writeFile(join(ws.path, 'report.md'), '# summary');

        const result = await manager.commitStep(ws, { stepId: 'ignore-step' });
        expect(result.changedFiles).toEqual(['report.md']);
      });
    });

    describe('pre-commit secret scan', () => {
      const secretSamples: Array<{ label: string; content: string }> = [
        { label: 'AWS access key', content: 'credentials: AKIAIOSFODNN7EXAMPLE' },
        { label: 'PEM header', content: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----' },
        { label: 'GitHub PAT', content: 'token = ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
        { label: 'OpenAI-style key', content: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345' },
      ];

      it.each(secretSamples)('$label in a tracked file aborts the commit', async ({ content }) => {
        const wd = {
          name: `wd-scan-${Math.random().toString(36).slice(2, 8)}`,
          workspace: {} as WorkflowWorkspace,
        };
        const ws = await manager.createRunWorkspace(wd, 'run-scan');
        await writeFile(join(ws.path, 'config.yaml'), content);

        await expect(manager.commitStep(ws, { stepId: 'scan-step' })).rejects.toThrow(/secret|credential/i);

        // Nothing got committed — HEAD still equals the start commit
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ws.path, encoding: 'utf-8' }).trim();
        expect(head).toBe(ws.startCommit);
      });

      it('clean content still commits without hitting the scanner', async () => {
        const wd = { name: 'wd-clean', workspace: {} as WorkflowWorkspace };
        const ws = await manager.createRunWorkspace(wd, 'run-clean');
        await writeFile(join(ws.path, 'report.md'), '# nothing sensitive here');

        const result = await manager.commitStep(ws, { stepId: 'clean-step' });
        expect(result.isEmpty).toBe(false);
        expect(result.changedFiles).toEqual(['report.md']);
      });
    });
  });

  describe('commit messages', () => {
    it('seed commit announces "Initialize workspace repository" and documents baseline patterns', async () => {
      const wd = { name: 'wd-seed-msg', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-seed-msg');

      const msg = execFileSync('git', ['log', '-1', '--format=%B', ws.startCommit], {
        cwd: ws.path, encoding: 'utf-8',
      });
      expect(msg.split('\n')[0]).toBe('◇ Initialize workspace repository');
      expect(msg).toMatch(/Baseline secret-guard patterns/);
      expect(msg).toMatch(/\*\.env/);
    });

    it('◆ marker for a regular step success with a single-file delta', async () => {
      const wd = { name: 'wd-msg-single', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-msg-single');
      await writeFile(join(ws.path, 'report.md'), '# hello');

      await manager.commitStep(ws, { stepId: 'summarize', stepName: 'Summarise' });

      const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ws.path, encoding: 'utf-8' }).trim();
      expect(subject).toBe('◆ Summarise → +report.md');
    });

    it('delta lists up to three files inline, then collapses to "first and N other files"', async () => {
      const wd = { name: 'wd-msg-many', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-msg-many');
      for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) {
        await writeFile(join(ws.path, name), name);
      }
      await manager.commitStep(ws, { stepId: 'bulk', stepName: 'Bulk write' });

      const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ws.path, encoding: 'utf-8' }).trim();
      expect(subject).toBe('◆ Bulk write → +a.txt and 4 other files');
    });

    it('✓ marker when isTerminal is set — last agent step of the run', async () => {
      const wd = { name: 'wd-msg-terminal', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-msg-terminal');
      await writeFile(join(ws.path, 'final.md'), 'done');

      await manager.commitStep(ws, {
        stepId: 'finish', stepName: 'Finish',
        isTerminal: true,
      });

      const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ws.path, encoding: 'utf-8' }).trim();
      expect(subject).toBe('✓ Finish → +final.md');
    });

    it('✗ marker for a failed step, with error excerpt in the body and Step-Status: failed trailer', async () => {
      const wd = { name: 'wd-msg-fail', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-msg-fail');
      await writeFile(join(ws.path, 'partial.log'), 'partial output');

      await manager.commitStep(ws, {
        stepId: 'doomed', stepName: 'Doomed step',
        status: 'failed',
        error: 'Docker container failed (exit code 1): package xyz not found',
      });

      const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: ws.path, encoding: 'utf-8' });
      expect(body.split('\n')[0]).toMatch(/^✗ Doomed step — failed: Docker container failed \(exit code 1\): package xyz not found$/);
      expect(body).toMatch(/Step-Status: failed/);
      expect(body).toMatch(/package xyz not found/);
      expect(body).toMatch(/\+partial\.log/);
    });

    it('writes structured trailers that tooling can parse back', async () => {
      const wd = { name: 'wd-msg-trailers', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-msg-trailers');
      await writeFile(join(ws.path, 'x.txt'), 'x');

      await manager.commitStep(ws, {
        stepId: 'generate-data',
        stepName: 'Generate sales.csv',
        durationMs: 4321,
        agentPlugin: 'script-container',
        agentImage: 'alpine:3.19',
      });

      const trailers = execFileSync('git', ['log', '-1', '--format=%(trailers)'], { cwd: ws.path, encoding: 'utf-8' });
      expect(trailers).toMatch(/Step-Id: generate-data/);
      expect(trailers).toMatch(/Run-Id: run-msg-trailers/);
      expect(trailers).toMatch(/Step-Status: success/);
      expect(trailers).toMatch(/Step-Duration-Ms: 4321/);
      expect(trailers).toMatch(/Agent-Plugin: script-container/);
      expect(trailers).toMatch(/Agent-Image: alpine:3\.19/);
      expect(trailers).toMatch(/Start-Commit: [a-f0-9]{40}/);
    });
  });
});

describe('formatFileDelta (pure function)', () => {
  it('empty entries → empty string', () => {
    expect(formatFileDelta([])).toBe('');
  });

  it('single added file', () => {
    expect(formatFileDelta([{ status: 'A', path: 'note.md' }])).toBe('+note.md');
  });

  it('two or three entries joined inline with status prefixes', () => {
    const entries = [
      { status: 'A', path: 'a.txt' },
      { status: 'M', path: 'b.txt' },
      { status: 'D', path: 'c.txt' },
    ];
    expect(formatFileDelta(entries)).toBe('+a.txt, ~b.txt, -c.txt');
  });

  it('more than three entries collapses to first + N other files', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ status: 'A', path: `f${i}.txt` }));
    expect(formatFileDelta(entries)).toBe('+f0.txt and 5 other files');
  });
});

describe('formatStepCommitMessage (pure function)', () => {
  const ws = { branch: 'run/abc-123', startCommit: 'a'.repeat(40) };

  it('◆ marker + step name + delta for a success with staged entries', () => {
    const msg = formatStepCommitMessage(ws, {
      stepId: 'gen', stepName: 'Generate',
    }, [{ status: 'A', path: 'out.txt' }]);
    expect(msg.split('\n')[0]).toBe('◆ Generate → +out.txt');
  });

  it('◆ marker with "no changes" when nothing staged and no summary', () => {
    const msg = formatStepCommitMessage(ws, { stepId: 'noop' }, []);
    expect(msg.split('\n')[0]).toBe('◆ noop — no changes');
  });

  it('✓ marker when isTerminal', () => {
    const msg = formatStepCommitMessage(ws, {
      stepId: 'fin', stepName: 'Final', isTerminal: true,
    }, [{ status: 'A', path: 'x' }]);
    expect(msg.split('\n')[0]).toBe('✓ Final → +x');
  });

  it('✗ marker for failed, with truncated error on subject', () => {
    const long = 'A'.repeat(200);
    const msg = formatStepCommitMessage(ws, {
      stepId: 'bad', stepName: 'Bad', status: 'failed', error: long,
    }, [{ status: 'A', path: 'p.log' }]);
    const subject = msg.split('\n')[0];
    expect(subject.startsWith('✗ Bad — failed: ')).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(120);
  });

  it('uses reasoningSummary on subject when available, delta goes in body', () => {
    const msg = formatStepCommitMessage(ws, {
      stepId: 'sum', stepName: 'Sum',
      reasoningSummary: 'Joined 3 tables and wrote report.',
    }, [{ status: 'A', path: 'report.md' }]);
    expect(msg.split('\n')[0]).toBe('◆ Sum — Joined 3 tables and wrote report.');
    expect(msg).toMatch(/\+report\.md/);
  });

  it('trailers include Run-Id extracted from ws.branch', () => {
    const msg = formatStepCommitMessage(ws, { stepId: 's' }, []);
    expect(msg).toMatch(/Run-Id: abc-123/);
    expect(msg).toMatch(/Step-Id: s/);
    expect(msg).toMatch(/Step-Status: success/);
  });
});
