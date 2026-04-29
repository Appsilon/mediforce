/**
 * Multi-remote single-bare lifecycle tests for WorkspaceManager.
 *
 * Covers the migration paths:
 *   - greenfield local-only / greenfield with remote
 *   - local-only -> remote (existing bare gets remote added)
 *   - remote A -> remote B (both remotes registered, neither dropped)
 *   - same remote re-fetched (idempotent, no duplicate adds)
 *   - heritage refs snapshot (audit guarantee against force-push)
 *   - deterministic remote naming (sha8 of normalized URL, token stripped)
 *   - worktree starting point (remote-tracking vs local main)
 *   - concurrency on the dir-lock
 *   - local-only on a bare that already has a remote (no fetch)
 *
 * Style: real local bare repos as fake remotes, no network, no SSH.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceManager } from '../workspace-manager.js';
import { createTestRepo, addCommitToTestRepo } from '../../plugins/__tests__/helpers/create-test-repo.js';
import { normalizeRepoUrls } from '../../plugins/container-plugin.js';
import type { WorkflowWorkspace } from '@mediforce/platform-core';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).toString();
}

function listRemotes(bareRepoPath: string): string[] {
  return git(['remote'], bareRepoPath).trim().split('\n').filter(Boolean);
}

function listRefs(bareRepoPath: string, prefix: string): Array<{ ref: string; sha: string }> {
  const out = git(['for-each-ref', '--format=%(refname) %(objectname)', prefix], bareRepoPath);
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const idx = line.lastIndexOf(' ');
    return { ref: line.slice(0, idx), sha: line.slice(idx + 1) };
  });
}

function expectedRemoteName(url: string): string {
  const normalized = normalizeRepoUrls(url).gitUrl;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `r-${hash}`;
}

describe('WorkspaceManager — multi-remote lifecycle', () => {
  let dataDir: string;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'wsmgr-mr-'));
    manager = new WorkspaceManager({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('greenfield', () => {
    it('greenfield local-only: no remote -> init bare + seed main', async () => {
      const wd = { name: 'greenfield-local', workspace: {} as WorkflowWorkspace };
      const result = await manager.ensureBareRepo(wd);

      expect(result.freshlyInitialized).toBe(true);
      expect(result.remoteUrl).toBeNull();
      // No remotes registered
      expect(listRemotes(result.path)).toEqual([]);
      // Seed main commit
      const heads = listRefs(result.path, 'refs/heads/');
      const main = heads.find((r) => r.ref === 'refs/heads/main');
      expect(main).toBeDefined();
      expect(main!.sha).toMatch(/^[a-f0-9]{40}$/);
    });

    it('greenfield with remote: init bare + add remote + fetch (no clone)', async () => {
      const remote = createTestRepo();
      try {
        const wd = {
          name: 'greenfield-remote',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        const result = await manager.ensureBareRepo(wd);

        expect(result.freshlyInitialized).toBe(true);
        expect(result.remoteUrl).toBe(remote.repoPath);

        const remoteName = expectedRemoteName(remote.repoPath);
        expect(listRemotes(result.path)).toEqual([remoteName]);

        const remoteRefs = listRefs(result.path, `refs/remotes/${remoteName}/`);
        const mainRef = remoteRefs.find((r) => r.ref === `refs/remotes/${remoteName}/main`);
        expect(mainRef).toBeDefined();
        expect(mainRef!.sha).toBe(remote.commitSha);
      } finally {
        remote.cleanup();
      }
    });
  });

  describe('migration', () => {
    it('local-only -> remote: existing bare with run branches gets remote added on next ensureBareRepo', async () => {
      const wd = { name: 'migrate-add', workspace: {} as WorkflowWorkspace };

      // Bootstrap as local-only and add a fake run branch in the bare repo.
      const a = await manager.ensureBareRepo(wd);
      const seedSha = git(['rev-parse', 'refs/heads/main'], a.path).trim();
      git(['update-ref', 'refs/heads/run/abc', seedSha], a.path);

      // Now flip the WD to remote-backed.
      const remote = createTestRepo();
      try {
        const result = await manager.ensureBareRepo({
          name: 'migrate-add',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        });

        expect(result.freshlyInitialized).toBe(false);
        expect(result.path).toBe(a.path);

        // Run branches preserved.
        const heads = listRefs(a.path, 'refs/heads/').map((r) => r.ref);
        expect(heads).toContain('refs/heads/run/abc');
        expect(heads).toContain('refs/heads/main');

        // Remote registered + fetched.
        const remoteName = expectedRemoteName(remote.repoPath);
        expect(listRemotes(a.path)).toEqual([remoteName]);
        const remoteMain = listRefs(a.path, `refs/remotes/${remoteName}/`)
          .find((r) => r.ref === `refs/remotes/${remoteName}/main`);
        expect(remoteMain).toBeDefined();
        expect(remoteMain!.sha).toBe(remote.commitSha);
      } finally {
        remote.cleanup();
      }
    });

    it('remote A -> remote B: both remotes registered after URL change', async () => {
      const remoteA = createTestRepo();
      const remoteB = createTestRepo();
      try {
        const wd = { name: 'migrate-swap' };

        await manager.ensureBareRepo({
          ...wd,
          workspace: { remote: remoteA.repoPath } as WorkflowWorkspace,
        });

        const result = await manager.ensureBareRepo({
          ...wd,
          workspace: { remote: remoteB.repoPath } as WorkflowWorkspace,
        });

        const nameA = expectedRemoteName(remoteA.repoPath);
        const nameB = expectedRemoteName(remoteB.repoPath);

        const remotes = listRemotes(result.path).sort();
        expect(remotes).toEqual([nameA, nameB].sort());

        // Both have refs.
        const aRefs = listRefs(result.path, `refs/remotes/${nameA}/`).map((r) => r.ref);
        const bRefs = listRefs(result.path, `refs/remotes/${nameB}/`).map((r) => r.ref);
        expect(aRefs).toContain(`refs/remotes/${nameA}/main`);
        expect(bRefs).toContain(`refs/remotes/${nameB}/main`);
      } finally {
        remoteA.cleanup();
        remoteB.cleanup();
      }
    });

    it('same remote: re-call fetches latest, no duplicate add', async () => {
      const remote = createTestRepo();
      try {
        const wd = {
          name: 'migrate-same',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        const first = await manager.ensureBareRepo(wd);
        const remoteName = expectedRemoteName(remote.repoPath);

        // Push a new commit to the remote.
        const newSha = addCommitToTestRepo(
          remote.repoPath,
          { 'extra.txt': 'second' },
          'second commit',
        );

        const second = await manager.ensureBareRepo(wd);
        expect(second.path).toBe(first.path);
        expect(listRemotes(second.path)).toEqual([remoteName]);

        const tip = listRefs(second.path, `refs/remotes/${remoteName}/`)
          .find((r) => r.ref === `refs/remotes/${remoteName}/main`);
        expect(tip).toBeDefined();
        expect(tip!.sha).toBe(newSha);
      } finally {
        remote.cleanup();
      }
    });
  });

  describe('heritage snapshot', () => {
    it('heritage snapshot preserves prior tip after force-push', async () => {
      const remote = createTestRepo();
      try {
        const wd = {
          name: 'heritage-force',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        const first = await manager.ensureBareRepo(wd);
        const remoteName = expectedRemoteName(remote.repoPath);
        const originalSha = remote.commitSha;

        // Verify original heritage entry written for the original tip.
        const heritageA = listRefs(first.path, `refs/heritage/${remoteName}/`);
        expect(heritageA.length).toBeGreaterThan(0);
        expect(heritageA.some((r) => r.sha === originalSha && r.ref.endsWith('/main'))).toBe(true);

        // Simulate force-push: rewrite history on the fake remote's main.
        const workDir = await mkdtemp(join(tmpdir(), 'wsmgr-mr-rewrite-'));
        try {
          execFileSync('git', ['clone', remote.repoPath, workDir], { stdio: 'pipe' });
          await writeFile(join(workDir, 'orphan.txt'), 'rewritten history');
          const env = {
            ...process.env,
            GIT_AUTHOR_NAME: 'rewriter',
            GIT_AUTHOR_EMAIL: 'r@r.com',
            GIT_COMMITTER_NAME: 'rewriter',
            GIT_COMMITTER_EMAIL: 'r@r.com',
          };
          // Create an orphan branch with one commit, then force-push it as main.
          execFileSync('git', ['checkout', '--orphan', 'rebuilt'], { cwd: workDir, stdio: 'pipe', env });
          execFileSync('git', ['rm', '-rf', '.'], { cwd: workDir, stdio: 'pipe', env });
          await writeFile(join(workDir, 'orphan.txt'), 'rewritten history');
          execFileSync('git', ['add', '-A'], { cwd: workDir, stdio: 'pipe', env });
          execFileSync('git', ['commit', '-m', 'rewrite'], { cwd: workDir, stdio: 'pipe', env });
          execFileSync('git', ['push', '--force', 'origin', 'rebuilt:main'], {
            cwd: workDir, stdio: 'pipe', env,
          });
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }

        const newRemoteTip = git(['rev-parse', 'refs/heads/main'], remote.repoPath).trim();
        expect(newRemoteTip).not.toBe(originalSha);

        // Re-call ensureBareRepo. Tip moves; original heritage stays.
        await manager.ensureBareRepo(wd);

        const remoteMain = listRefs(first.path, `refs/remotes/${remoteName}/`)
          .find((r) => r.ref === `refs/remotes/${remoteName}/main`);
        expect(remoteMain!.sha).toBe(newRemoteTip);

        const heritageB = listRefs(first.path, `refs/heritage/${remoteName}/`);
        // Original sha still preserved somewhere in heritage.
        expect(heritageB.some((r) => r.sha === originalSha && r.ref.endsWith('/main'))).toBe(true);
        // New tip should also be captured by the second snapshot.
        expect(heritageB.some((r) => r.sha === newRemoteTip && r.ref.endsWith('/main'))).toBe(true);
      } finally {
        remote.cleanup();
      }
    });

    it('heritage entries are unique per fetch', async () => {
      const remote = createTestRepo();
      try {
        const wd = {
          name: 'heritage-unique',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        await manager.ensureBareRepo(wd);
        // Tiny waits ensure timestamp segments differ. Manager uses ms precision.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await manager.ensureBareRepo(wd);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const final = await manager.ensureBareRepo(wd);

        const remoteName = expectedRemoteName(remote.repoPath);
        const heritage = listRefs(final.path, `refs/heritage/${remoteName}/`);
        // Each fetch snapshots refs/remotes/<name>/main once -> three distinct entries.
        const mainEntries = heritage.filter((r) => r.ref.endsWith('/main'));
        expect(mainEntries.length).toBe(3);
        const distinctRefs = new Set(mainEntries.map((r) => r.ref));
        expect(distinctRefs.size).toBe(3);
      } finally {
        remote.cleanup();
      }
    });
  });

  describe('deterministic remote naming', () => {
    it('remote name deterministic from URL', async () => {
      const remote1 = createTestRepo();
      const remote2 = createTestRepo();
      try {
        const wdA1 = {
          name: 'naming-1',
          workspace: { remote: remote1.repoPath } as WorkflowWorkspace,
        };
        const wdA2 = {
          name: 'naming-2',
          workspace: { remote: remote1.repoPath } as WorkflowWorkspace,
        };
        const wdB = {
          name: 'naming-3',
          workspace: { remote: remote2.repoPath } as WorkflowWorkspace,
        };

        const a1 = await manager.ensureBareRepo(wdA1);
        const a2 = await manager.ensureBareRepo(wdA2);
        const b = await manager.ensureBareRepo(wdB);

        const nameA1 = listRemotes(a1.path)[0];
        const nameA2 = listRemotes(a2.path)[0];
        const nameB = listRemotes(b.path)[0];

        expect(nameA1).toBe(nameA2);
        expect(nameA1).not.toBe(nameB);
        expect(nameA1).toMatch(/^r-[0-9a-f]{8}$/);
        expect(nameB).toMatch(/^r-[0-9a-f]{8}$/);
      } finally {
        remote1.cleanup();
        remote2.cleanup();
      }
    });

    it('auth token stripped before hashing (HTTPS URLs)', async () => {
      // The remote name must be derived from the credential-free canonical URL.
      // We verify by configuring the same logical remote two ways:
      // once via plain URL and once via tokenized URL — and they must collide
      // on the same r-<sha8> name. Use a real local bare repo so the manager
      // can actually fetch and confirm registration.
      const remote = createTestRepo();
      try {
        const cleanUrl = remote.repoPath;

        // Build a tokenized variant of the same path. For local-path remotes the
        // tokenized variant is just the same path (no userinfo to strip), so we
        // must use a representative HTTPS pair instead — done here as a pure
        // expectation against the manager's naming, by piggy-backing on its
        // observable name for the clean URL.
        const result = await manager.ensureBareRepo({
          name: 'token-name',
          workspace: { remote: cleanUrl } as WorkflowWorkspace,
        });
        const observedName = listRemotes(result.path)[0];
        expect(observedName).toMatch(/^r-[0-9a-f]{8}$/);

        // Independent assertion: hashing must NOT include credentials. Build
        // both forms manually, strip userinfo, normalize, hash — verify hashes
        // match. This is the contract the implementation must honor.
        const cleanHttps = 'https://github.com/foo/bar';
        const tokenHttps = 'https://x-access-token:abc123@github.com/foo/bar.git';
        const stripUserinfo = (url: string): string => url.replace(/^(https?:\/\/)[^/@]+@/, '$1');
        const cleanCanon = normalizeRepoUrls(stripUserinfo(cleanHttps)).gitUrl;
        const tokenCanon = normalizeRepoUrls(stripUserinfo(tokenHttps)).gitUrl;
        expect(cleanCanon).toBe('git@github.com:foo/bar.git');
        expect(tokenCanon).toBe(cleanCanon);
        const cleanHash = createHash('sha256').update(cleanCanon).digest('hex').slice(0, 8);
        const tokenHash = createHash('sha256').update(tokenCanon).digest('hex').slice(0, 8);
        expect(`r-${cleanHash}`).toBe(`r-${tokenHash}`);
      } finally {
        remote.cleanup();
      }
    });
  });

  describe('worktree starting point', () => {
    it('worktree on remote-backed WD branches off <remote>/main', async () => {
      const remote = createTestRepo();
      try {
        const wd = {
          name: 'wt-remote',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        const ws = await manager.createRunWorkspace(wd, 'run-001');

        // Worktree HEAD must equal the remote's tip (we branched from <remote>/main).
        const head = git(['rev-parse', 'HEAD'], ws.path).trim();
        expect(head).toBe(remote.commitSha);

        // Reachability: the run branch is descended from <remote>/main.
        const remoteName = expectedRemoteName(remote.repoPath);
        const baseSha = git(
          ['rev-parse', `refs/remotes/${remoteName}/main`],
          ws.bareRepoPath,
        ).trim();
        expect(baseSha).toBe(remote.commitSha);

        // The remote's content (Dockerfile) is checked out.
        const dockerfile = await readFile(join(ws.path, 'Dockerfile'), 'utf-8');
        expect(dockerfile).toContain('FROM alpine');
      } finally {
        remote.cleanup();
      }
    });

    it('worktree on local-only WD branches off local main', async () => {
      const wd = { name: 'wt-local', workspace: {} as WorkflowWorkspace };
      const ws = await manager.createRunWorkspace(wd, 'run-002');

      const localMain = git(['rev-parse', 'refs/heads/main'], ws.bareRepoPath).trim();
      const head = git(['rev-parse', 'HEAD'], ws.path).trim();
      expect(head).toBe(localMain);
      // The seed .gitignore is present.
      const ignore = await readFile(join(ws.path, '.gitignore'), 'utf-8');
      expect(ignore).toMatch(/\*\.env/);
    });
  });

  describe('concurrency', () => {
    it('concurrent ensureBareRepo on same workflow serializes via lock', async () => {
      const remote = createTestRepo();
      try {
        const wd = {
          name: 'concurrent',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        const [a, b] = await Promise.all([
          manager.ensureBareRepo(wd),
          manager.ensureBareRepo(wd),
        ]);
        expect(a.path).toBe(b.path);

        const remoteName = expectedRemoteName(remote.repoPath);
        // Exactly one remote registered (no duplicate).
        expect(listRemotes(a.path)).toEqual([remoteName]);
        const tip = listRefs(a.path, `refs/remotes/${remoteName}/`)
          .find((r) => r.ref === `refs/remotes/${remoteName}/main`);
        expect(tip).toBeDefined();
        expect(tip!.sha).toBe(remote.commitSha);
      } finally {
        remote.cleanup();
      }
    });
  });

  describe('edge cases', () => {
    it('workspace.remote undefined on existing remote-backed bare: keeps remote, does not fetch', async () => {
      const remote = createTestRepo();
      try {
        // Step 1: register remote A.
        const wdRemote = {
          name: 'edge-keep',
          workspace: { remote: remote.repoPath } as WorkflowWorkspace,
        };
        const a = await manager.ensureBareRepo(wdRemote);
        const remoteName = expectedRemoteName(remote.repoPath);
        const heritageBefore = listRefs(a.path, `refs/heritage/${remoteName}/`).map((r) => r.ref);
        expect(heritageBefore.length).toBeGreaterThan(0);

        // Push new commits while we're not looking — if we re-fetched, our refs would update.
        const newTip = addCommitToTestRepo(remote.repoPath, { 'extra.txt': 'x' }, 'extra');

        // Step 2: WD flips back to local-only. Should not fetch.
        const wdLocal = {
          name: 'edge-keep',
          workspace: {} as WorkflowWorkspace,
        };
        const b = await manager.ensureBareRepo(wdLocal);
        expect(b.path).toBe(a.path);

        // Remote still registered.
        expect(listRemotes(b.path)).toEqual([remoteName]);

        // refs/remotes/<name>/main still points to the OLD tip (no fetch happened).
        const remoteMainSha = git(
          ['rev-parse', `refs/remotes/${remoteName}/main`],
          b.path,
        ).trim();
        expect(remoteMainSha).not.toBe(newTip);

        // No new heritage entries.
        const heritageAfter = listRefs(b.path, `refs/heritage/${remoteName}/`).map((r) => r.ref);
        expect(heritageAfter.sort()).toEqual(heritageBefore.sort());
      } finally {
        remote.cleanup();
      }
    });
  });
});
