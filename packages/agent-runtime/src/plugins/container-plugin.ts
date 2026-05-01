/**
 * Abstract base class for plugins that run Docker containers.
 *
 * Shared logic: image build metadata resolution, env var resolution, context storage,
 * workspace lifecycle. Subclasses: BaseContainerAgentPlugin (LLM agents),
 * ScriptContainerPlugin (deterministic scripts).
 *
 * ## Container mounts — the `/workspace` vs `/output` split
 *
 * Every step container gets two bind mounts with distinct lifecycles and purposes.
 * Keeping them separate is deliberate — merging them would blur several concerns
 * that deserve to stay apart.
 *
 *   /workspace (host path = run worktree)
 *     - Git worktree for the run, shared across all its steps.
 *     - rw, persistent for the life of the run, tracked in git.
 *     - Commit happens at step boundaries; ignored files are wiped between steps.
 *     - This is where the agent / script writes *deliverables* — code, data,
 *       reports — whatever the workflow produces for its user.
 *
 *   /output (host path = per-step tempdir)
 *     - Ephemeral I/O channel between the engine and the step. Born on step
 *       start, deleted on step end. Never touched by git.
 *     - Host seeds inputs here before the container starts: `input.json`
 *       (stepInput), `previous_run.json` (carry-over), `prompt.txt` (agent
 *       plugins), `script.<ext>` (inline script mode), `mcp-config.json`.
 *     - The container writes the result contract: `result.json`.
 *     - Host reads `result.json` + optional `presentation.html` + `git-result.json`
 *       (written by the host itself post-commit) after the container exits.
 *
 * ### Why separate
 *
 * - **Commit history stays about user work.** Inputs / prompts / previous-run
 *   payloads are engine plumbing. Committing them on every step would flood
 *   the run branch with housekeeping noise.
 * - **No naming conflicts.** A step that wants to write its own `input.json`
 *   or `result.json` as a deliverable can do so in `/workspace/...` without
 *   colliding with engine-owned files.
 * - **Control-plane vs data-plane.** `/output` is how the engine talks to the
 *   step; `/workspace` is what the step produces. Mixing them makes both
 *   harder to reason about.
 * - **Replay reproducibility is not weakened.** stepInput lives in Firestore
 *   (`processInstances/<id>/stepExecutions`). `/output/input.json` is a
 *   derivative — writing it to git would be duplication, not extra truth.
 *
 * ### Naming caveat
 *
 * The `/output` name is imperfect — it carries both inputs and outputs. If we
 * renamed it today we'd pick `/io` or `/step-io`. The current name is kept
 * because every existing `SKILL.md`, workflow definition, and prompt hardcodes
 * `/output/result.json`. A rename is a breaking change across all those and
 * belongs in its own PR.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, chmodSync, copyFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type { AgentPlugin, AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';
import { writeFile } from 'node:fs/promises';
import type { GitMetadata } from '@mediforce/platform-core';
import { resolveStepEnv, type ResolvedEnv } from './resolve-env.js';
import type { ImageBuildMeta } from './docker-spawn-strategy.js';
import { WorkspaceManager, type RunWorkspaceHandle } from '../workspace/workspace-manager.js';

let preparedDeployKeyPath: string | null = null;

/**
 * Returns a deploy-key path that ssh will accept — copies the configured key
 * to a private tmp file with 0600 perms so host-side mount modes can't break us.
 *
 * NOTE: Keep in sync with the duplicated copy in
 * `packages/container-worker/src/docker-image-builder.ts` — container-worker cannot
 * import from agent-runtime without dragging in Firebase deps.
 */
export function prepareDeployKeyPath(): string {
  const source = process.env.DEPLOY_KEY_PATH ?? join(homedir(), '.ssh', 'deploy_key');
  if (!existsSync(source)) return source;
  if (preparedDeployKeyPath && existsSync(preparedDeployKeyPath)) return preparedDeployKeyPath;
  const dir = mkdtempSync(join(tmpdir(), 'mediforce-ssh-'));
  const dest = join(dir, 'deploy_key');
  copyFileSync(source, dest);
  chmodSync(dest, 0o600);
  preparedDeployKeyPath = dest;
  return dest;
}

/** Normalize a repo reference to SSH clone URL and HTTPS browsable URL.
 *  Supports: "org/repo", "git@github.com:org/repo.git", "https://github.com/org/repo", "/path/to/bare.git" */
export function normalizeRepoUrls(repo: string): { gitUrl: string; httpsUrl: string } {
  if (repo.startsWith('/') || repo.startsWith('.')) {
    return { gitUrl: repo, httpsUrl: '' };
  }
  if (repo.startsWith('git@')) {
    const match = repo.match(/git@github\.com:(.+?)(?:\.git)?$/);
    const orgRepo = match ? match[1] : repo;
    return { gitUrl: repo, httpsUrl: `https://github.com/${orgRepo}` };
  }
  if (repo.startsWith('https://')) {
    const clean = repo.replace(/\.git$/, '');
    const match = clean.match(/https:\/\/github\.com\/(.+)/);
    const sshUrl = match ? `git@github.com:${match[1]}.git` : `${clean}.git`;
    return { gitUrl: sshUrl, httpsUrl: clean };
  }
  return {
    gitUrl: `git@github.com:${repo}.git`,
    httpsUrl: `https://github.com/${repo}`,
  };
}

export function isWorkflowAgentContext(ctx: AgentContext | WorkflowAgentContext): ctx is WorkflowAgentContext {
  return 'step' in ctx && 'workflowDefinition' in ctx;
}

/**
 * Resolve image build metadata for lazy Docker image building.
 *
 * A step opts in to lazy build when it has:
 *   a) step-level repo + commit (explicit — always enables lazy build), OR
 *   b) step-level dockerfile + workflow-level repo with commit (fallback)
 *
 * Steps without repo/commit/dockerfile are left alone (image must already exist).
 */
/**
 * Resolve the repo auth token from the step or workflow-level config.
 * `repoAuth` is the name of a key in resolvedEnv (sourced from workflow secrets).
 */
export function resolveRepoToken(
  agentConfig: AgentConfig,
  context: AgentContext | WorkflowAgentContext,
  resolvedEnv?: Record<string, string>,
): string | undefined {
  // Step-level repoAuth takes priority
  const authKey = agentConfig.repoAuth
    ?? (isWorkflowAgentContext(context) ? context.workflowDefinition.repo?.auth : undefined);
  if (!authKey || !resolvedEnv) return undefined;
  return resolvedEnv[authKey];
}

export function resolveImageBuild(
  image: string,
  agentConfig: AgentConfig,
  context: AgentContext | WorkflowAgentContext,
  resolvedEnv?: Record<string, string>,
): ImageBuildMeta | undefined {
  const { dockerfile, repo, commit } = agentConfig;

  if (repo && commit) {
    return {
      image,
      repoUrl: normalizeRepoUrls(repo).gitUrl,
      commit,
      dockerfile,
      repoToken: resolveRepoToken(agentConfig, context, resolvedEnv),
    };
  }

  if (dockerfile && isWorkflowAgentContext(context)) {
    const wfRepo = context.workflowDefinition.repo;
    if (wfRepo?.url && wfRepo?.commit) {
      return {
        image,
        repoUrl: repo ? normalizeRepoUrls(repo).gitUrl : normalizeRepoUrls(wfRepo.url).gitUrl,
        commit: commit ?? wfRepo.commit,
        dockerfile,
        repoToken: resolveRepoToken(agentConfig, context, resolvedEnv),
      };
    }
  }

  return undefined;
}

const SKILLS_CACHE_DIR = join(tmpdir(), 'mediforce-skills-cache');

/** Convert SSH git URL to HTTPS with token for authenticated clone. */
export function toHttpsWithToken(sshUrl: string, token: string): string {
  const match = sshUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (match) {
    return `https://x-access-token:${token}@github.com/${match[1]}.git`;
  }
  return sshUrl.replace('https://', `https://x-access-token:${token}@`);
}

export interface CommitRunWorkspaceOptions {
  status?: 'success' | 'failed';
  /** Force the terminal marker (✓). Auto-detected from transitions when omitted. */
  isTerminal?: boolean;
  /** Optional agent reasoning summary — shown on the commit subject line. */
  reasoningSummary?: string;
  /** Error message for failed commits — placed in the commit body. */
  error?: string;
  /** Wall-clock step duration in milliseconds. Emitted as a trailer. */
  durationMs?: number;
  /** Plugin identifier override. Defaults to the subclass's `metadata.name`. */
  agentPlugin?: string;
  /** Docker image reference. Emitted as a trailer. */
  agentImage?: string;
}

export interface WorkspaceManagerLike {
  createRunWorkspace: WorkspaceManager['createRunWorkspace'];
  commitStep: WorkspaceManager['commitStep'];
}

export interface ContainerPluginInit {
  workspaceManager?: WorkspaceManagerLike;
}

export abstract class ContainerPlugin implements AgentPlugin {
  abstract readonly metadata: PluginCapabilityMetadata;

  protected context!: AgentContext | WorkflowAgentContext;
  protected resolvedEnv: ResolvedEnv = { vars: {}, injectedKeys: [] };
  protected imageBuild: ImageBuildMeta | undefined;
  /** Cached skills dir path fetched from git repo. */
  protected repoSkillsDir: string | null = null;
  /** Run-scoped git worktree — populated by `resolveRunWorkspace` at run start. */
  protected runWorkspaceHandle: RunWorkspaceHandle | null = null;
  protected workspaceManager: WorkspaceManagerLike | null = null;

  constructor(init: ContainerPluginInit = {}) {
    this.workspaceManager = init.workspaceManager ?? null;
  }

  abstract initialize(context: AgentContext | WorkflowAgentContext): Promise<void>;
  abstract run(emit: EmitFn): Promise<void>;

  protected createWorkspaceManager(): WorkspaceManagerLike {
    return new WorkspaceManager();
  }

  /**
   * Provision a per-run git worktree. Every step gets one — if the WD has no
   * `workspace` config, the runtime uses a default empty workspace (local-only
   * bare repo). Idempotent across the run's steps: subsequent calls re-attach
   * to the same worktree.
   */
  protected async resolveRunWorkspace(): Promise<void> {
    const workspaceConfig = isWorkflowAgentContext(this.context)
      ? (this.context.workflowDefinition.workspace ?? {})
      : {};

    const name = isWorkflowAgentContext(this.context)
      ? this.context.workflowDefinition.name
      : this.context.config.processName;
    const namespace = isWorkflowAgentContext(this.context)
      ? this.context.workflowDefinition.namespace
      : undefined;

    if (!this.workspaceManager) {
      this.workspaceManager = this.createWorkspaceManager();
    }

    const remoteToken = workspaceConfig.remoteAuth
      ? this.resolvedEnv.vars[workspaceConfig.remoteAuth]
      : undefined;

    this.runWorkspaceHandle = await this.workspaceManager.createRunWorkspace(
      { name, namespace, workspace: workspaceConfig },
      this.context.processInstanceId,
      { remoteToken },
    );
  }

  /**
   * Commit the step's workspace changes — ALWAYS, even on failure and even
   * when nothing changed. The run branch is meant to be a complete audit
   * trail of what the engine dispatched; `--allow-empty` keeps it isomorphic
   * to the step timeline.
   *
   * Marker selection:
   *   ◆ regular success
   *   ✓ last agent step of the run (no more agents will touch the workspace)
   *   ✗ failed — commits whatever the step produced before the error
   *
   * Writes `git-result.json` into `outputDir` for downstream consumers.
   * Never pushes — run branches stay local for now.
   */
  protected async commitRunWorkspace(
    outputDir: string,
    opts: CommitRunWorkspaceOptions = {},
  ): Promise<GitMetadata | null> {
    if (!this.runWorkspaceHandle || !this.workspaceManager) return null;

    const commit = await this.workspaceManager.commitStep(this.runWorkspaceHandle, {
      stepId: this.context.stepId,
      stepName: this.resolveStepName(),
      status: opts.status ?? 'success',
      isTerminal: opts.isTerminal ?? this.detectLastAgentStep(),
      reasoningSummary: opts.reasoningSummary,
      error: opts.error,
      durationMs: opts.durationMs,
      agentPlugin: opts.agentPlugin ?? this.metadata.name,
      agentImage: opts.agentImage,
    });

    const metadata: GitMetadata = {
      commitSha: commit.commitSha,
      branch: this.runWorkspaceHandle.branch,
      changedFiles: commit.changedFiles,
      repoUrl: this.runWorkspaceHandle.remoteUrl ?? this.runWorkspaceHandle.bareRepoPath,
    };

    await writeFile(join(outputDir, 'git-result.json'), JSON.stringify(metadata, null, 2), 'utf-8');
    return metadata;
  }

  /** Resolve the display name of the current step (falls back to stepId). */
  private resolveStepName(): string {
    if (isWorkflowAgentContext(this.context)) {
      return this.context.step.name ?? this.context.step.id;
    }
    return this.context.stepId;
  }

  /**
   * Last agent step = no outgoing transition leads to another non-terminal,
   * non-human step. We look at all outgoing transitions from the current step;
   * if every reachable next step is either `type: terminal` or `executor: human`,
   * this plugin invocation is the last one to touch the workspace, so its
   * commit gets the ✓ marker.
   *
   * Conditional transitions with mixed targets keep the regular ◆ marker —
   * we'd need to evaluate the condition to decide, and that's the engine's
   * job, not the plugin's.
   */
  private detectLastAgentStep(): boolean {
    if (!isWorkflowAgentContext(this.context)) return false;
    const { workflowDefinition, step } = this.context;
    const outgoing = workflowDefinition.transitions.filter((t) => t.from === step.id);
    if (outgoing.length === 0) return true;
    return outgoing.every((t) => {
      const next = workflowDefinition.steps.find((s) => s.id === t.to);
      if (!next) return true;
      return next.type === 'terminal' || next.executor === 'human';
    });
  }

  /**
   * Resolve environment variables from definition-level + step-level env + workflow secrets.
   */
  protected resolveEnvironment(
    definitionEnv?: Record<string, string>,
    stepEnv?: Record<string, string>,
    workflowSecrets?: Record<string, string>,
  ): void {
    this.resolvedEnv = resolveStepEnv(definitionEnv, stepEnv, workflowSecrets);
  }

  /**
   * Fetch skills from a git repo into a deterministic cache directory.
   * Cache key: sha256(repoUrl + commit + skillsDir).
   * Returns the path to the cached skills directory.
   */
  protected async fetchSkillsFromRepo(
    skillsDir: string,
    repoUrl: string,
    commit: string,
    repoToken?: string,
  ): Promise<string> {
    const hash = createHash('sha256').update(`${repoUrl}\0${commit}\0${skillsDir}`).digest('hex').slice(0, 16);
    const cacheDir = join(SKILLS_CACHE_DIR, hash);

    // Cache hit
    if (existsSync(cacheDir)) {
      console.log(`[container-plugin] Skills cache hit for ${skillsDir} (${hash})`);
      this.repoSkillsDir = cacheDir;
      return cacheDir;
    }

    // Cache miss — clone, copy, delete clone
    console.log(`[container-plugin] Fetching skills from ${repoUrl}@${commit.slice(0, 8)} path=${skillsDir}`);
    const cloneDir = mkdtempSync(join(tmpdir(), 'mediforce-skills-clone-'));

    try {
      const cloneUrl = repoToken ? toHttpsWithToken(repoUrl, repoToken) : repoUrl;
      const deployKeyPath = prepareDeployKeyPath();
      const execOpts = {
        stdio: 'pipe' as const,
        env: { ...process.env, GIT_SSH_COMMAND: `ssh -i ${deployKeyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes` },
      };

      execSync(`git init "${cloneDir}"`, execOpts);
      execSync(`git -C "${cloneDir}" remote add origin "${cloneUrl}"`, execOpts);
      execSync(`git -C "${cloneDir}" fetch origin "${commit}" --depth 1`, execOpts);
      execSync(`git -C "${cloneDir}" checkout FETCH_HEAD`, execOpts);

      const sourceDir = join(cloneDir, skillsDir);
      if (!existsSync(sourceDir)) {
        throw new Error(
          `Skills directory "${skillsDir}" not found in repo ${repoUrl}@${commit.slice(0, 8)}`,
        );
      }

      mkdirSync(SKILLS_CACHE_DIR, { recursive: true });
      cpSync(sourceDir, cacheDir, { recursive: true });
      console.log(`[container-plugin] Skills cached at ${cacheDir}`);
    } finally {
      rmSync(cloneDir, { recursive: true, force: true });
    }

    this.repoSkillsDir = cacheDir;
    return cacheDir;
  }

  /**
   * Resolve skillsDir — uses repo cache if available, otherwise resolveProjectPath.
   */
  protected resolveSkillsDir(skillsDir: string, resolveProjectPath: (p: string) => string): string {
    if (this.repoSkillsDir) {
      return this.repoSkillsDir;
    }
    return resolveProjectPath(skillsDir);
  }
}
