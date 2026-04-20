/**
 * Abstract base class for plugins that run Docker containers.
 *
 * Shared logic: image build metadata resolution, env var resolution, context storage.
 * Subclasses: BaseContainerAgentPlugin (LLM agents), ScriptContainerPlugin (deterministic scripts).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, chmodSync, copyFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type { AgentPlugin, AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';
import { resolveStepEnv, type ResolvedEnv } from './resolve-env.js';
import type { ImageBuildMeta } from './docker-spawn-strategy.js';

let preparedDeployKeyPath: string | null = null;

/**
 * Returns a deploy-key path that ssh will accept — copies the configured key
 * to a private tmp file with 0600 perms so host-side mount modes can't break us.
 *
 * NOTE: Keep in sync with the duplicated copy in
 * `packages/agent-queue/src/docker-image-builder.ts` — agent-queue cannot
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

export abstract class ContainerPlugin implements AgentPlugin {
  abstract readonly metadata: PluginCapabilityMetadata;

  protected context!: AgentContext | WorkflowAgentContext;
  protected resolvedEnv: ResolvedEnv = { vars: {}, injectedKeys: [] };
  protected imageBuild: ImageBuildMeta | undefined;
  /** Cached skills dir path fetched from git repo. */
  protected repoSkillsDir: string | null = null;

  abstract initialize(context: AgentContext | WorkflowAgentContext): Promise<void>;
  abstract run(emit: EmitFn): Promise<void>;

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
