/**
 * Run-scoped git workspace manager.
 *
 * Model:
 *   - one bare repo per workflow definition, cached on the host
 *   - one `git worktree` per run, branched from main as `run/<runId>`
 *   - every step in the run mounts that worktree; commits happen at step boundaries
 *
 * Storage layout (under `dataDir`, defaulting to `${MEDIFORCE_DATA_DIR ?? ~/.mediforce}`):
 *
 *   bare-repos/<namespace>/<name>.git/
 *   worktrees/<namespace>/<name>/<runId>/
 *
 * Concurrency:
 *   Bare repo fetch uses a lock directory to serialize concurrent runs updating the mirror.
 *   Worktrees of different runs are independent (different branches, different paths).
 *
 * Not covered here (v1 scope):
 *   - GC / retention of old run branches
 *   - automatic merges back to main
 *   - shallow clones (we keep full history for audit)
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { WorkflowWorkspace } from '@mediforce/platform-core';
import { normalizeRepoUrls, toHttpsWithToken } from '../plugins/container-plugin.js';

/**
 * Baseline gitignore-style patterns applied to every workspace via `.git/info/exclude`.
 * These do not modify `main` (user remains the source of truth for tracked files) —
 * they just prevent common secret filenames from being staged by accident.
 */
const BASELINE_IGNORE_PATTERNS = [
  '# Mediforce workspace — baseline secret guard (auto-written, do not hand-edit)',
  '*.env',
  '*.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_rsa.*',
  'id_ed25519',
  'id_ed25519.*',
  '**/credentials',
  '**/credentials.*',
  '**/.secrets/',
  '.secrets/',
  '',
];

/**
 * Regex patterns for secrets that might sneak into otherwise-innocent files
 * (e.g. `config.yaml` with an inline API key). First match aborts the commit.
 * Keep the list conservative — false positives block real work.
 */
const SECRET_CONTENT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'PEM-encoded key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
];

export class SecretDetectedError extends Error {
  constructor(matches: Array<{ file: string; kind: string }>) {
    const summary = matches
      .map((m) => `  - ${m.file}: ${m.kind}`)
      .join('\n');
    super(
      `Refusing to commit — secret-like content detected in staged files:\n${summary}\n` +
      `Remove the sensitive content or add the file to .gitignore before retrying.`,
    );
    this.name = 'SecretDetectedError';
  }
}

export interface WorkflowIdentity {
  name: string;
  namespace?: string;
}

export interface WorkspaceManagerInit {
  /** Root dir for bare repos and worktrees. Defaults to `${MEDIFORCE_DATA_DIR ?? ~/.mediforce}`. */
  dataDir?: string;
  /** Overrides `process.env.DEPLOY_KEY_PATH ?? ~/.ssh/deploy_key`. */
  deployKeyPath?: string;
}

export interface EnsureBareRepoOptions {
  /** Resolved token value (not a secret name). When set, HTTPS auth is used for remote ops. */
  remoteToken?: string;
}

export interface BareRepoHandle {
  path: string;
  /** True when the bare repo is brand new (just initialized). */
  freshlyInitialized: boolean;
  /** Resolved git URL used for remote ops, or null for local-only bare repos. */
  remoteUrl: string | null;
}

export interface RunWorkspaceHandle {
  /** Absolute worktree path — bind-mount target for step containers. */
  path: string;
  /** Run branch (`run/<runId>`). */
  branch: string;
  /** SHA at worktree creation. */
  startCommit: string;
  /** Backing bare repo path. */
  bareRepoPath: string;
  /** Resolved remote URL (may be null). */
  remoteUrl: string | null;
}

export interface CommitStepOptions {
  stepId: string;
  /** Human-readable step name used in the commit subject. Defaults to `stepId`. */
  stepName?: string;
  /** Outcome of the step — chooses the commit marker (◆ success, ✗ failed). */
  status?: 'success' | 'failed';
  /** True when this is the last agent step of the run — swaps ◆ for ✓. */
  isTerminal?: boolean;
  /** Agent-provided summary placed on the subject line after the step name. */
  reasoningSummary?: string;
  /** Error excerpt for failed steps — goes into the commit body. */
  error?: string;
  /** Wall-clock step duration in milliseconds. Emitted as a trailer. */
  durationMs?: number;
  /** Plugin identifier (e.g. `script-container`). Emitted as a trailer. */
  agentPlugin?: string;
  /** Docker image reference. Emitted as a trailer. */
  agentImage?: string;
  /**
   * Overrides the subject line entirely. Use sparingly — the auto-format is
   * the "10x better" message design and should almost always be preferred.
   */
  message?: string;
}

export interface CommitStepResult {
  commitSha: string;
  changedFiles: string[];
  /** True when the commit had no staged changes (created with `--allow-empty`). */
  isEmpty: boolean;
}

const STATUS_PREFIX: Record<string, string> = { A: '+', M: '~', D: '-', R: '+', C: '+', T: '~' };

/**
 * Render the staged file list into a compact delta string for the commit subject.
 *
 *   []                                    → ''
 *   [{A, 'note.md'}]                      → '+note.md'
 *   [{A,'a'}, {A,'b'}, {M,'c'}]           → '+a, +b, ~c'
 *   [{A,'a'}, {A,'b'}, {A,'c'}, {A,'d'}]  → '+a and 3 other files'
 *
 * The "and N other files" form names only the first entry — the full list
 * lives in the commit body; the subject stays readable.
 */
export function formatFileDelta(entries: Array<{ status: string; path: string }>): string {
  if (entries.length === 0) return '';
  const labels = entries.map((e) => `${STATUS_PREFIX[e.status[0]] ?? '+'}${e.path}`);
  if (labels.length === 1) return labels[0];
  if (labels.length <= 3) return labels.join(', ');
  return `${labels[0]} and ${labels.length - 1} other files`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build the full commit message for a step:
 *
 *   <marker> <stepName> <delta-or-summary-or-failed>
 *
 *   <optional body: full change list, agent reasoning summary, error excerpt>
 *
 *   Step-Id: <id>
 *   Run-Id: <runId>
 *   Step-Status: success|failed
 *   Step-Duration-Ms: <n>
 *   Agent-Plugin: <plugin>
 *   Agent-Image: <image>
 *   Start-Commit: <sha>
 */
export function formatStepCommitMessage(
  ws: { branch: string; startCommit: string },
  opts: CommitStepOptions,
  stagedEntries: Array<{ status: string; path: string }>,
): string {
  const status = opts.status ?? 'success';
  const stepName = opts.stepName ?? opts.stepId;
  const delta = formatFileDelta(stagedEntries);
  const summary = opts.reasoningSummary?.split('\n')[0].trim();

  // Subject
  let subject: string;
  if (status === 'failed') {
    const firstErrLine = (opts.error ?? '').split('\n')[0].trim();
    subject = firstErrLine
      ? `✗ ${stepName} — failed: ${truncate(firstErrLine, 80)}`
      : `✗ ${stepName} — failed`;
  } else {
    const marker = opts.isTerminal ? '✓' : '◆';
    if (summary) {
      subject = `${marker} ${stepName} — ${truncate(summary, 80)}`;
    } else if (delta) {
      subject = `${marker} ${stepName} → ${truncate(delta, 120)}`;
    } else {
      subject = `${marker} ${stepName} — no changes`;
    }
  }

  // Body
  const bodyParts: string[] = [];
  if (stagedEntries.length > 0) {
    const fileLines = stagedEntries.map((e) => `  ${STATUS_PREFIX[e.status[0]] ?? '+'}${e.path}`);
    bodyParts.push(['Changes:', ...fileLines].join('\n'));
  }
  if (status === 'failed' && opts.error) {
    bodyParts.push(`Error:\n${truncate(opts.error, 1000)}`);
  }
  if (status === 'success' && summary && delta) {
    // Summary was used in subject → note separately with full multi-line reasoning if different
    const full = opts.reasoningSummary!.trim();
    if (full !== summary) bodyParts.push(full);
  }

  // Trailers
  const runId = ws.branch.startsWith('run/') ? ws.branch.slice(4) : ws.branch;
  const trailers: string[] = [
    `Step-Id: ${opts.stepId}`,
    `Run-Id: ${runId}`,
    `Step-Status: ${status}`,
  ];
  if (typeof opts.durationMs === 'number') trailers.push(`Step-Duration-Ms: ${opts.durationMs}`);
  if (opts.agentPlugin) trailers.push(`Agent-Plugin: ${opts.agentPlugin}`);
  if (opts.agentImage) trailers.push(`Agent-Image: ${opts.agentImage}`);
  if (ws.startCommit) trailers.push(`Start-Commit: ${ws.startCommit}`);

  const sections = [subject];
  if (bodyParts.length > 0) sections.push(bodyParts.join('\n\n'));
  sections.push(trailers.join('\n'));
  return sections.join('\n\n');
}

function sanitizeSegment(segment: string): string {
  // Allow alphanumerics, dashes, underscores, dots. Replace anything else with an underscore.
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function defaultDataDir(): string {
  return process.env.MEDIFORCE_DATA_DIR ?? join(homedir(), '.mediforce');
}

function resolveDeployKeyPath(override?: string): string {
  return override ?? process.env.DEPLOY_KEY_PATH ?? join(homedir(), '.ssh', 'deploy_key');
}

function buildSshCmd(deployKeyPath: string): string {
  return `ssh -i ${deployKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
}

function gitEnv(sshCmd: string): NodeJS.ProcessEnv {
  return { ...process.env, GIT_SSH_COMMAND: sshCmd };
}

function runGit(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {}): string {
  const out = execFileSync('git', args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    encoding: 'utf-8',
  });
  return typeof out === 'string' ? out : '';
}

/** Try git; swallow stderr, return null on failure. Used for "does branch exist" checks. */
function tryGit(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): boolean {
  try {
    execFileSync('git', args, { cwd: opts.cwd, env: opts.env, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic lock on a directory via `mkdir` (O_CREAT|O_EXCL equivalent).
 * Retries with 50ms backoff until `timeoutMs` elapses.
 */
async function withDirLock<T>(lockDir: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  await mkdir(join(lockDir, '..'), { recursive: true });
  while (true) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for lock at ${lockDir}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export class WorkspaceManager {
  private readonly dataDir: string;
  private readonly deployKeyPath: string;

  constructor(init: WorkspaceManagerInit = {}) {
    this.dataDir = init.dataDir ?? defaultDataDir();
    this.deployKeyPath = resolveDeployKeyPath(init.deployKeyPath);
  }

  private bareRepoPath(workflow: WorkflowIdentity): string {
    return join(this.dataDir, 'bare-repos', sanitizeSegment(workflow.namespace ?? '_default'), `${sanitizeSegment(workflow.name)}.git`);
  }

  private worktreePath(workflow: WorkflowIdentity, runId: string): string {
    return join(this.dataDir, 'worktrees', sanitizeSegment(workflow.namespace ?? '_default'), sanitizeSegment(workflow.name), sanitizeSegment(runId));
  }

  private fetchLockPath(bareRepoPath: string): string {
    return `${bareRepoPath}.fetch.lock`;
  }

  private resolveRemoteUrl(workspace: WorkflowWorkspace, token?: string): string | null {
    if (!workspace.remote) return null;
    const { gitUrl } = normalizeRepoUrls(workspace.remote);
    if (token) return toHttpsWithToken(gitUrl, token);
    return gitUrl;
  }

  /**
   * Ensure the bare repo exists and, if a remote is configured, is reasonably up to date.
   * Idempotent. Safe to call from concurrent runs — fetches are serialized by a file lock.
   */
  async ensureBareRepo(
    workflow: WorkflowIdentity & { workspace: WorkflowWorkspace },
    opts: EnsureBareRepoOptions = {},
  ): Promise<BareRepoHandle> {
    const bareRepoPath = this.bareRepoPath(workflow);
    const remoteUrl = this.resolveRemoteUrl(workflow.workspace, opts.remoteToken);
    const lockPath = this.fetchLockPath(bareRepoPath);

    // One lock for both init and fetch — ensures two concurrent runs don't race
    // on init/seed or both trying to update origin/fetch at the same time.
    return withDirLock(lockPath, 60_000, async () => {
      const exists = await pathExists(join(bareRepoPath, 'HEAD'));

      if (!exists) {
        await mkdir(join(bareRepoPath, '..'), { recursive: true });
        if (remoteUrl) {
          runGit(['clone', '--bare', remoteUrl, bareRepoPath], { env: gitEnv(buildSshCmd(this.deployKeyPath)) });
        } else {
          // Local-only bare repo: init and seed a single initial commit on `main`
          // containing a baseline `.gitignore`. Every run branch then starts from
          // a known state with secret-pattern ignores already in effect.
          runGit(['init', '--bare', '--initial-branch=main', bareRepoPath]);
          this.seedMainWithGitignore(bareRepoPath);
        }
        // Also write .git/info/exclude as a per-repo safety net — this catches
        // the same secret patterns even if a remote repo's main has no .gitignore.
        await this.writeBaselineExclude(bareRepoPath);
        return { path: bareRepoPath, freshlyInitialized: true, remoteUrl };
      }

      if (remoteUrl) {
        runGit(['remote', 'set-url', 'origin', remoteUrl], { cwd: bareRepoPath });
        runGit(['fetch', '--prune', 'origin'], { cwd: bareRepoPath, env: gitEnv(buildSshCmd(this.deployKeyPath)) });
      }

      return { path: bareRepoPath, freshlyInitialized: false, remoteUrl };
    });
  }

  /**
   * Write the baseline secret-guard patterns into `.git/info/exclude`.
   * Scoped per-repo: does not touch the tracked `.gitignore` (user owns main).
   */
  private async writeBaselineExclude(bareRepoPath: string): Promise<void> {
    const excludePath = join(bareRepoPath, 'info', 'exclude');
    await mkdir(join(bareRepoPath, 'info'), { recursive: true });
    await writeFile(excludePath, BASELINE_IGNORE_PATTERNS.join('\n'), 'utf-8');
  }

  /**
   * Seed an initial commit on `main` containing a baseline `.gitignore`.
   * Uses pure git plumbing — no worktree, no tempdir, no file I/O dance.
   *
   *   1. hash-object → blob for the .gitignore content
   *   2. mktree → tree with just that file at the root
   *   3. commit-tree → initial commit pointing at that tree
   *   4. update-ref → fast-forward `refs/heads/main` to the new commit
   */
  private seedMainWithGitignore(bareRepoPath: string): void {
    const content = BASELINE_IGNORE_PATTERNS.join('\n');
    const commitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Mediforce Workspace',
      GIT_AUTHOR_EMAIL: 'workspace@mediforce.dev',
      GIT_COMMITTER_NAME: 'Mediforce Workspace',
      GIT_COMMITTER_EMAIL: 'workspace@mediforce.dev',
    };

    const blobSha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: bareRepoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      input: content,
    }).toString().trim();

    const treeSha = execFileSync('git', ['mktree'], {
      cwd: bareRepoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      input: `100644 blob ${blobSha}\t.gitignore\n`,
    }).toString().trim();

    const seedMessage = [
      '◇ Initialize workspace repository',
      '',
      'Baseline secret-guard patterns active via .gitignore:',
      '  *.env, *.pem, *.key, id_rsa*, **/credentials*, .secrets/',
      '',
      'Every run branches from this commit. History is never rewritten;',
      'run branches accumulate ◆ (step) / ✓ (terminal) / ✗ (failed) commits.',
    ].join('\n');

    const commitSha = execFileSync('git', ['commit-tree', treeSha, '-m', seedMessage], {
      cwd: bareRepoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      env: commitEnv,
    }).toString().trim();

    execFileSync('git', ['update-ref', 'refs/heads/main', commitSha], {
      cwd: bareRepoPath,
      stdio: 'pipe',
    });
  }

  /**
   * Create (or return existing) per-run worktree on branch `run/<runId>`.
   * Idempotent: if the worktree for this `(workflow, runId)` already exists, returns its handle.
   *
   * Starting ref resolution:
   *   - branch already in bare repo (e.g. pre-existing on remote) → reuse it
   *   - otherwise → branch from `main` (always present; local-only bare repos are
   *     seeded with an initial `.gitignore` commit on init)
   */
  async createRunWorkspace(
    workflow: WorkflowIdentity & { workspace: WorkflowWorkspace },
    runId: string,
    opts: EnsureBareRepoOptions = {},
  ): Promise<RunWorkspaceHandle> {
    const bare = await this.ensureBareRepo(workflow, opts);
    const wtPath = this.worktreePath(workflow, runId);
    const branch = `run/${runId}`;

    if (await pathExists(join(wtPath, '.git'))) {
      // Worktree already set up — step N>1 of an already-started run
      const head = runGit(['rev-parse', 'HEAD'], { cwd: wtPath }).trim();
      return { path: wtPath, branch, startCommit: head, bareRepoPath: bare.path, remoteUrl: bare.remoteUrl };
    }

    await mkdir(join(wtPath, '..'), { recursive: true });

    const branchExists = tryGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: bare.path });
    if (branchExists) {
      runGit(['worktree', 'add', wtPath, branch], { cwd: bare.path });
    } else {
      runGit(['worktree', 'add', '-b', branch, wtPath, 'main'], { cwd: bare.path });
    }

    runGit(['config', 'user.email', 'agent@mediforce.dev'], { cwd: wtPath });
    runGit(['config', 'user.name', `Mediforce Workspace (${workflow.name})`], { cwd: wtPath });

    const head = runGit(['rev-parse', 'HEAD'], { cwd: wtPath }).trim();
    return { path: wtPath, branch, startCommit: head, bareRepoPath: bare.path, remoteUrl: bare.remoteUrl };
  }

  /**
   * Stage all changes and commit. Always commits (even with no changes, via
   * `--allow-empty`) so the run branch is an isomorphic audit trail of every
   * step the engine dispatched — success, failure, or no-op.
   *
   * Throws `SecretDetectedError` if any staged added line matches a secret
   * pattern — the commit is aborted and the worktree state is left as-is for
   * inspection.
   *
   * After the commit, runs `git clean -fdX` to remove ignored files so the
   * next step in the same run sees a worktree whose contents match what git
   * records. This protects step-to-step reproducibility: ignored files
   * (e.g. `*.env`, `.secrets/`) are never carried over between steps.
   *
   * Commit message format (see `formatStepCommitMessage` for the details):
   *
   *   ◆ <step name> → +path/to/file               (regular success)
   *   ✓ <step name> → +path/to/file               (last agent step)
   *   ✗ <step name> — failed: <first error line>  (failure — commits anyway)
   *
   * Body carries the full change list + optional agent reasoning; trailers
   * carry structured metadata (Step-Id, Run-Id, Step-Status, Step-Duration-Ms,
   * Agent-Plugin, Agent-Image, Start-Commit) that tooling can parse back out.
   */
  async commitStep(ws: RunWorkspaceHandle, opts: CommitStepOptions): Promise<CommitStepResult> {
    runGit(['add', '-A'], { cwd: ws.path });

    // Peek at what's staged — needed for the file delta in the subject line,
    // and drives whether we pass --allow-empty to git commit.
    const nameStatus = runGit(['diff', '--cached', '--name-status'], { cwd: ws.path }).trim();
    const stagedEntries = nameStatus
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status, path: rest.join('\t') };
      });

    // Scan content even for failed steps — we never want secrets on the branch.
    if (stagedEntries.length > 0) {
      const secretMatches = this.scanStagedDiffForSecrets(ws.path);
      if (secretMatches.length > 0) {
        runGit(['reset'], { cwd: ws.path });
        throw new SecretDetectedError(secretMatches);
      }
    }

    const message = opts.message ?? formatStepCommitMessage(ws, opts, stagedEntries);
    const isEmpty = stagedEntries.length === 0;
    const commitArgs = ['commit', '-m', message];
    if (isEmpty) commitArgs.splice(1, 0, '--allow-empty');
    runGit(commitArgs, { cwd: ws.path });

    const commitSha = runGit(['rev-parse', 'HEAD'], { cwd: ws.path }).trim();
    const changedFiles = isEmpty
      ? []
      : runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha], { cwd: ws.path })
          .trim()
          .split('\n')
          .filter(Boolean);

    runGit(['clean', '-fdX'], { cwd: ws.path });
    return { commitSha, changedFiles, isEmpty };
  }

  /**
   * Scan the staged diff for secret-shaped content on newly-added lines.
   * Returns the list of (file, kind) pairs that matched; empty = all clear.
   */
  private scanStagedDiffForSecrets(cwd: string): Array<{ file: string; kind: string }> {
    const diff = runGit(['diff', '--cached', '--unified=0'], { cwd });
    const matches: Array<{ file: string; kind: string }> = [];
    let currentFile: string | null = null;

    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git ')) {
        // Format: `diff --git a/<path> b/<path>` — we take the post-image side
        const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
        currentFile = match ? match[1] : null;
        continue;
      }
      // Skip file-header lines (+++ b/...) and unchanged context (we use -U0 so there's none)
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (!line.startsWith('+')) continue;
      const added = line.slice(1);
      if (!currentFile) continue;

      for (const { name, pattern } of SECRET_CONTENT_PATTERNS) {
        if (pattern.test(added)) {
          matches.push({ file: currentFile, kind: name });
          break; // one kind per line is enough to flag the file
        }
      }
    }

    return matches;
  }

  /**
   * Remove the worktree from disk. The branch stays in the bare repo.
   * Safe to call on a non-existent worktree.
   */
  async disposeRunWorkspace(ws: RunWorkspaceHandle): Promise<void> {
    if (!(await pathExists(ws.path))) return;
    try {
      runGit(['worktree', 'remove', '--force', ws.path], { cwd: ws.bareRepoPath });
    } catch {
      // Fall back to rm if git complains (e.g., worktree metadata already gone)
      await rm(ws.path, { recursive: true, force: true });
      runGit(['worktree', 'prune'], { cwd: ws.bareRepoPath });
    }
  }

  /**
   * Enumerate worktrees currently on disk (does not touch git state).
   * Layout: `<dataDir>/worktrees/<namespace>/<name>/<runId>`.
   *
   * Callers decide which to dispose — policy (e.g. "only terminal runs")
   * lives where the run state does, not in filesystem plumbing.
   */
  async listRunWorktrees(): Promise<Array<{
    namespace: string;
    workflowName: string;
    runId: string;
    path: string;
    bareRepoPath: string;
  }>> {
    const worktreesRoot = join(this.dataDir, 'worktrees');
    if (!(await pathExists(worktreesRoot))) return [];

    const result: Array<{
      namespace: string;
      workflowName: string;
      runId: string;
      path: string;
      bareRepoPath: string;
    }> = [];

    for (const namespace of await readdir(worktreesRoot).catch(() => [])) {
      const nsDir = join(worktreesRoot, namespace);
      for (const name of await readdir(nsDir).catch(() => [])) {
        const wdDir = join(nsDir, name);
        const bareRepoPath = join(this.dataDir, 'bare-repos', namespace, `${name}.git`);
        for (const runId of await readdir(wdDir).catch(() => [])) {
          const wtPath = join(wdDir, runId);
          const info = await stat(wtPath).catch(() => null);
          if (!info || !info.isDirectory()) continue;
          result.push({ namespace, workflowName: name, runId, path: wtPath, bareRepoPath });
        }
      }
    }

    return result;
  }
}
