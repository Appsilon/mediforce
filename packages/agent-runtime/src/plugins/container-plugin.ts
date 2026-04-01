/**
 * Abstract base class for plugins that run Docker containers.
 *
 * Shared logic: image build metadata resolution, env var resolution, context storage.
 * Subclasses: BaseContainerAgentPlugin (LLM agents), ScriptContainerPlugin (deterministic scripts).
 */
import type { AgentPlugin, AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';
import { resolveStepEnv, type ResolvedEnv } from './resolve-env.js';
import type { ImageBuildMeta } from './docker-spawn-strategy.js';

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
export function resolveImageBuild(
  image: string,
  agentConfig: AgentConfig,
  context: AgentContext | WorkflowAgentContext,
): ImageBuildMeta | undefined {
  const { dockerfile, repo, commit } = agentConfig;

  if (repo && commit) {
    return {
      image,
      repoUrl: normalizeRepoUrls(repo).gitUrl,
      commit,
      dockerfile,
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
      };
    }
  }

  return undefined;
}

export abstract class ContainerPlugin implements AgentPlugin {
  abstract readonly metadata: PluginCapabilityMetadata;

  protected context!: AgentContext | WorkflowAgentContext;
  protected resolvedEnv: ResolvedEnv = { vars: {}, injectedKeys: [] };
  protected imageBuild: ImageBuildMeta | undefined;

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
}
