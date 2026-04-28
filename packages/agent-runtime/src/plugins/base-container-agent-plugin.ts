import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, writeFile, rm, mkdir, appendFile, realpath, cp } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata, GitMetadata, McpServerConfig, ResolvedMcpConfig } from '@mediforce/platform-core';
import { resolveStepEnv, resolveValue, type ResolvedEnv } from './resolve-env.js';
import { getDockerSpawnStrategy, type ImageBuildMeta } from './docker-spawn-strategy.js';
import { ContainerPlugin, isWorkflowAgentContext, resolveImageBuild, resolveRepoToken, normalizeRepoUrls } from './container-plugin.js';
import { renderOAuthHeader } from '../oauth/resolve-oauth-token.js';

/** Thrown when a resolved HTTP MCP binding declares `auth.type === 'oauth'`
 *  but the agent context carries no OAuth token entry for that server. The
 *  message points the user at the UI to connect the account — that's the
 *  only place the token can be provisioned. */
export class OAuthTokenUnavailableError extends Error {
  public readonly serverName: string;
  public readonly provider: string;

  constructor(serverName: string, provider: string) {
    super(
      `OAuth token for MCP server "${serverName}" (provider "${provider}") is not connected. ` +
      `Connect the account via the agent editor in the UI, then retry the step.`,
    );
    this.name = 'OAuthTokenUnavailableError';
    this.serverName = serverName;
    this.provider = provider;
  }
}

const __filename_base = fileURLToPath(import.meta.url);
const __dirname_base = dirname(__filename_base);

export const DEFAULT_TIMEOUT_MS = 20 * 60_000;

/** Container-side path for bind-mounted Claude Code plugin roots. */
export const CONTAINER_PLUGIN_MOUNT = '/plugin';

// Monorepo root: this file lives at packages/agent-runtime/src/plugins/
const MONOREPO_ROOT = process.env.MEDIFORCE_ROOT ?? resolve(__dirname_base, '../../../..');

/** Resolve a path relative to the monorepo root. */
function resolveProjectPath(relativePath: string): string {
  if (isAbsolute(relativePath)) return relativePath;
  return resolve(MONOREPO_ROOT, relativePath);
}

/** Structured logger for agent runtime. Writes to stderr (captured by Docker). */
function agentLog(tag: string, message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    tag,
    message,
    ...data,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

/**
 * Check whether local (non-Docker) agent execution is allowed.
 * Currently gated by the ALLOW_LOCAL_AGENTS environment variable.
 * Encapsulated here so it can later be swapped to a DB/settings lookup.
 */
export function isLocalExecutionAllowed(): boolean {
  return process.env.ALLOW_LOCAL_AGENTS === 'true';
}

/** Strip YAML frontmatter (--- ... ---) from markdown content. */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

export interface FileEntry {
  name: string;
  downloadUrl: string;
  localPath?: string;
  [key: string]: unknown;
}

export interface SpawnCliOptions {
  model?: string;
  addDirs?: string[];
  logFile?: string;
  timeoutMs?: number;
  outputDir?: string;
  /**
   * Host path to the Claude Code plugin root — the directory containing
   * `.claude-plugin/plugin.json` and `skills/`. When set, the runtime
   * bind-mounts this at `/plugin` in Docker mode and agents can pass it
   * via `--plugin-dir` so native skill resolution (including `references/`)
   * works without polluting the workspace.
   */
  pluginDir?: string;
}

export interface SpawnDockerResult {
  cliOutput: string;
  gitMetadata: GitMetadata | null;
  presentation: string | null;
  outputDir: string;
  /** Env var names injected into the process (for audit logging) */
  injectedEnvVars: string[];
}

export interface AgentOutputContract {
  output_file?: string;
  summary?: string;
}

/** Spec returned by subclass to define how the agent CLI is invoked inside the container. */
export interface AgentCommandSpec {
  /** CLI args appended after the Docker image name (and optional entrypoint). */
  args: string[];
  /** How to deliver the prompt to the agent CLI.
   *  'stdin' — pipe prompt to child.stdin (Claude Code)
   *  'file'  — prompt is referenced in args via /output/prompt.txt (OpenCode) */
  promptDelivery: 'stdin' | 'file';
}


function hasFiles(input: Record<string, unknown>): input is Record<string, unknown> & { files: FileEntry[] } {
  return Array.isArray(input.files) &&
    input.files.length > 0 &&
    typeof input.files[0].downloadUrl === 'string';
}

/** Download remote files to a temp directory and return updated input with localPath fields. */
export async function downloadFilesToLocal(
  stepInput: Record<string, unknown>,
): Promise<{ updatedInput: Record<string, unknown>; tempDir: string | null }> {
  if (!hasFiles(stepInput)) {
    return { updatedInput: stepInput, tempDir: null };
  }

  // Resolve symlinks (macOS: /var -> /private/var) so --allowedTools patterns match
  const rawTempDir = await mkdtemp(join(tmpdir(), 'mediforce-agent-'));
  const tempDir = await realpath(rawTempDir);
  const updatedFiles: FileEntry[] = [];

  for (const file of stepInput.files) {
    const localPath = join(tempDir, file.name);
    const response = await fetch(file.downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download '${file.name}': HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, buffer);
    updatedFiles.push({ ...file, localPath });
  }

  return {
    updatedInput: { ...stepInput, files: updatedFiles },
    tempDir,
  };
}

/** Clean up temp directory, swallowing errors. */
export async function cleanupTempDir(tempDir: string | null): Promise<void> {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Build the `headers` map for an HTTP MCP entry based on the resolved
 *  binding's auth discriminator. Returns undefined when there's no auth
 *  to emit — the caller omits the `headers` key entirely in that case.
 *
 *  - `type: 'headers'` — resolves `{{SECRET:...}}` / `{{NAME}}` templates in
 *    each value via `resolveValue` so `mcp-config.json` ships final strings.
 *  - `type: 'oauth'` — looks up the pre-loaded access token in
 *    `context.oauthTokens[serverName]`. When the binding requests OAuth
 *    but no token has been connected yet, throws an `OAuthTokenUnavailableError`
 *    rather than silently dropping the header — a half-authed agent would
 *    generate confusing 401s from the downstream MCP server. */
function buildHttpHeaders(
  serverName: string,
  auth: { type: 'headers'; headers: Record<string, string> } | { type: 'oauth'; provider: string; headerName: string; headerValueTemplate: string; scopes?: string[] } | undefined,
  oauthTokens: Record<string, { accessToken: string; headerName: string; headerValueTemplate: string }> | undefined,
  workflowSecrets: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (auth === undefined) return undefined;

  if (auth.type === 'headers') {
    const resolved: Record<string, string> = {};
    for (const [name, value] of Object.entries(auth.headers)) {
      resolved[name] = resolveValue(value, workflowSecrets);
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  }

  // auth.type === 'oauth' — the token must be pre-loaded in context.
  // Resolve via the binding-supplied header settings instead of the auth
  // config so future per-token overrides (e.g. rotated header name) stay
  // consistent with what was actually connected.
  const bundle = oauthTokens?.[serverName];
  if (bundle === undefined) {
    throw new OAuthTokenUnavailableError(serverName, auth.provider);
  }
  const headerValue = renderOAuthHeader(bundle.headerValueTemplate, bundle.accessToken);
  return { [bundle.headerName]: headerValue };
}

/**
 * Abstract base class for container-based agent plugins.
 *
 * Handles all generic Docker orchestration: volume mounts, git mode,
 * prompt assembly, output extraction, file downloads, mock mode.
 * Subclasses implement agent-specific CLI invocation, env vars, and output parsing.
 */
export abstract class BaseContainerAgentPlugin extends ContainerPlugin {
  protected agentConfig!: AgentConfig;

  /** Human-readable agent name for log/status messages (e.g. "Claude Code", "OpenCode"). */
  abstract readonly agentName: string;

  /** Return plugin-internal env vars needed by the container (e.g. config paths).
   *  NOT for API keys — those come from the step config's `env` field.
   *  Default: empty. */
  protected getInternalEnvVars(): Record<string, string> {
    return {};
  }

  /** Return plugin-internal env vars for local (non-Docker) execution.
   *  Override when container paths differ from host paths (e.g. /output/ vs actual outputDir).
   *  Default: delegates to getInternalEnvVars(). */
  protected getLocalInternalEnvVars(_outputDir: string): Record<string, string> {
    return this.getInternalEnvVars();
  }

  /** Return the CLI command spec to run the agent inside the container.
   *  @param promptFilePath — container path to the prompt file (/output/prompt.txt) */
  abstract getAgentCommand(promptFilePath: string, options?: SpawnCliOptions): AgentCommandSpec;

  /** Return docker command args for mock mode (MOCK_AGENT=true).
   *  Must produce stdout that parseAgentOutput() can handle. */
  abstract getMockDockerArgs(stepId: string): string[];

  /** Extract the final result string from raw stdout (all lines joined).
   *  Must return a JSON string parseable by extractResult().
   *  Expected format: JSON object with a `result` field containing the agent's output string. */
  abstract parseAgentOutput(rawStdout: string): string;

  /** Process a single stdout line for activity logging.
   *  Return JSONL strings to append to the log file.
   *  Default: no-op (no streaming log support). */
  protected processOutputLine(_line: string): string[] {
    return [];
  }

  /** Extract a human-readable error detail from the final result/output.
   *  Default: null (no error extraction). */
  protected extractErrorFromResult(_resultLine: string): string | null {
    return null;
  }

  /**
   * Recover agent output when no result event was emitted (e.g. model stopped
   * after tool calls). Tries result.json first, then scans for any files the
   * agent wrote to /output/.
   */
  protected async recoverOutputFromDirectory(outputDir: string): Promise<string> {
    // 1. Try result.json (the expected contract location)
    try {
      const contents = await readFile(join(outputDir, 'result.json'), 'utf-8');
      try {
        const parsed = JSON.parse(contents) as Record<string, unknown>;
        return JSON.stringify({ result: JSON.stringify(parsed) });
      } catch {
        return JSON.stringify({ result: contents });
      }
    } catch {
      // result.json not found — continue to directory scan
    }

    // 2. Scan output directory for any files the agent wrote
    const entries = await readdir(outputDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name !== 'prompt.txt');

    if (files.length === 0) {
      throw new Error('No output files found');
    }

    // Read all output files and assemble a result
    const collected: Record<string, unknown> = {};
    for (const file of files) {
      const content = await readFile(join(outputDir, file.name), 'utf-8');
      try {
        collected[file.name] = JSON.parse(content);
      } catch {
        collected[file.name] = content;
      }
    }

    // If there's exactly one file, use its content as the result directly
    const resultPayload = files.length === 1
      ? collected[files[0].name]
      : collected;

    return JSON.stringify({ result: JSON.stringify(resultPayload) });
  }

  /** Hook called after the output directory is created and prompt.txt is written,
   *  but before the Docker container is spawned. Override to write additional files
   *  (e.g. agent config) into the output dir that will be mounted at /output. */
  protected async prepareOutputDir(outputDir: string): Promise<void> {
    await this.writeMcpConfig(outputDir);
  }

  /** Generate mcp-config.json for Claude CLI --mcp-config flag.
   *  Resolves {{SECRET}} templates in MCP server env vars.
   *
   *  Two sources, checked in order:
   *   1. Workflow-mode with a pre-resolved config from resolveMcpForStep
   *      (context.resolvedMcpConfig). This is the canonical path — bindings
   *      come from the referenced AgentDefinition + step restrictions.
   *   2. Legacy inline config on agentConfig.mcpServers (array of
   *      McpServerConfig). Still used by process-mode steps and
   *      by workflow steps that predate the migration to agentId. */
  protected async writeMcpConfig(outputDir: string): Promise<void> {
    const resolved = isWorkflowAgentContext(this.context)
      ? this.context.resolvedMcpConfig
      : undefined;

    if (resolved !== undefined) {
      await this.writeResolvedMcpConfig(outputDir, resolved);
      return;
    }

    await this.writeLegacyMcpConfig(outputDir);
  }

  /** Serialize a resolved MCP config into the flat mcp-config.json shape
   *  Claude CLI expects. Applies {{SECRET}} template resolution to env
   *  values on stdio entries and to any HTTP `auth.type === 'headers'`
   *  values at write time. For `auth.type === 'oauth'`, the access token
   *  comes from `context.oauthTokens[name]` (pre-loaded + pre-refreshed
   *  by the caller) and is stamped into `headerValueTemplate`. */
  private async writeResolvedMcpConfig(
    outputDir: string,
    resolved: ResolvedMcpConfig,
  ): Promise<void> {
    const entries = Object.entries(resolved.servers);
    if (entries.length === 0) return;

    const workflowSecrets = isWorkflowAgentContext(this.context)
      ? this.context.workflowSecrets
      : undefined;
    const oauthTokens = isWorkflowAgentContext(this.context)
      ? this.context.oauthTokens
      : undefined;

    type StdioEntry = { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; allowedTools?: string[] };
    type HttpEntry = { type: 'http'; url: string; headers?: Record<string, string>; allowedTools?: string[] };
    const mcpConfig: Record<string, StdioEntry | HttpEntry> = {};

    for (const [name, server] of entries) {
      const allowedToolsPart = server.allowedTools && server.allowedTools.length > 0
        ? { allowedTools: server.allowedTools }
        : {};

      if (server.type === 'stdio') {
        const resolvedEnv: Record<string, string> = {};
        if (server.env) {
          for (const [key, value] of Object.entries(server.env)) {
            resolvedEnv[key] = resolveValue(value, workflowSecrets);
          }
        }
        mcpConfig[name] = {
          type: 'stdio',
          command: server.command,
          ...(server.args !== undefined && server.args.length > 0 ? { args: server.args } : {}),
          ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
          ...allowedToolsPart,
        };
      } else {
        const headers = buildHttpHeaders(name, server.auth, oauthTokens, workflowSecrets);
        mcpConfig[name] = {
          type: 'http',
          url: server.url,
          ...(headers !== undefined ? { headers } : {}),
          ...allowedToolsPart,
        };
      }
    }

    await writeFile(
      join(outputDir, 'mcp-config.json'),
      JSON.stringify({ mcpServers: mcpConfig }, null, 2),
      'utf-8',
    );

    agentLog('mcp.config', 'MCP config written (resolver-backed)', {
      stepId: this.context.stepId,
      servers: entries.map(([name]) => name),
    });
  }

  /** Pre-refactor path: serialize agentConfig.mcpServers (array) directly
   *  into mcp-config.json. Retained for process-mode steps and any
   *  workflow step that has not yet migrated to agentId. */
  private async writeLegacyMcpConfig(outputDir: string): Promise<void> {
    const servers = this.agentConfig.mcpServers;
    if (!servers || servers.length === 0) return;

    const workflowSecrets = isWorkflowAgentContext(this.context)
      ? this.context.workflowSecrets
      : undefined;

    type StdioEntry = { type: 'stdio'; command: string; args: string[]; env?: Record<string, string>; allowedTools?: string[] };
    type HttpEntry = { type: 'http'; url: string; allowedTools?: string[] };
    const mcpConfig: Record<string, StdioEntry | HttpEntry> = {};

    for (const server of servers) {
      const resolvedEnv: Record<string, string> = {};
      if (server.env) {
        for (const [key, value] of Object.entries(server.env)) {
          resolvedEnv[key] = resolveValue(value, workflowSecrets);
        }
      }

      const allowedToolsPart = server.allowedTools && server.allowedTools.length > 0
        ? { allowedTools: server.allowedTools }
        : {};

      if (server.command) {
        mcpConfig[server.name] = {
          type: 'stdio',
          command: server.command,
          args: server.args ?? [],
          ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
          ...allowedToolsPart,
        };
      } else if (server.url) {
        mcpConfig[server.name] = {
          type: 'http',
          url: server.url,
          ...allowedToolsPart,
        };
      } else {
        throw new Error(`MCP server '${server.name}': either command or url must be provided`);
      }
    }

    await writeFile(
      join(outputDir, 'mcp-config.json'),
      JSON.stringify({ mcpServers: mcpConfig }, null, 2),
      'utf-8',
    );

    agentLog('mcp.config', 'MCP config written (legacy)', {
      stepId: this.context.stepId,
      servers: servers.map((s) => s.name),
    });
  }

  /**
   * Scan outputDir for deliverable files (HTML, PDF, CSV, etc.) — excluding
   * internal agent files. Copy the first match to a stable temp location so
   * it survives output-dir cleanup, and return the absolute copied path.
   * Returns null if nothing found.
   *
   * Two-phase logic:
   * 1. Loop over known deliverable extensions, skipping INTERNAL_NAMES.
   *    `presentation.html` is in INTERNAL_NAMES so it's skipped here.
   * 2. Fallback: try `presentation.html` separately. It's excluded from the
   *    loop because it's already read into spawnResult.presentation, but we
   *    still need a persisted path so the Download Report button can serve it.
   */
  protected async persistDeliverableFile(
    outputDir: string,
    instanceId: string,
    stepId: string,
  ): Promise<string | null> {
    const INTERNAL_NAMES = new Set([
      'opencode.json', 'auth.json', 'prompt.txt', 'result.json',
      'git-result.json', 'mock-result.json', 'presentation.html',
    ]);
    const DELIVERABLE_EXTS = new Set(['.html', '.htm', '.pdf', '.csv', '.xlsx', '.md']);

    let entries: string[];
    try {
      entries = await readdir(outputDir);
    } catch {
      return null;
    }

    for (const name of entries) {
      if (INTERNAL_NAMES.has(name)) continue;
      if (name.startsWith('.')) continue;
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (!DELIVERABLE_EXTS.has(ext)) continue;

      const srcPath = join(outputDir, name);
      const destDir = join(tmpdir(), 'mediforce-deliverables', instanceId);
      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, name);
      try {
        await cp(srcPath, destPath);
        return destPath;
      } catch {
        continue;
      }
    }

    // Also handle presentation.html (already read as spawnResult.presentation but path needed)
    const presentationPath = join(outputDir, 'presentation.html');
    try {
      const destDir = join(tmpdir(), 'mediforce-deliverables', instanceId);
      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, `${stepId}-presentation.html`);
      await cp(presentationPath, destPath);
      return destPath;
    } catch {
      return null;
    }
  }

  /** Resolve the host path to the mock-fixtures directory for this step's plugin.
   *  Returns null if skillsDir is not set. */
  protected getMockFixturesDir(): string | null {
    if (!this.agentConfig.skillsDir) return null;
    return join(this.resolveSkillsDir(this.agentConfig.skillsDir, resolveProjectPath), '..', 'mock-fixtures');
  }

  /** Resolve the host path to the mock data directory from _config.json.
   *  Returns null if no config or dataDir is defined. */
  protected async getMockDataDir(): Promise<string | null> {
    const fixturesDir = this.getMockFixturesDir();
    if (!fixturesDir) return null;
    try {
      const configRaw = await readFile(join(fixturesDir, '_config.json'), 'utf-8');
      const config = JSON.parse(configRaw) as { dataDir?: string };
      if (config.dataDir) {
        return join(fixturesDir, config.dataDir);
      }
    } catch {
      // No _config.json or invalid — skip data mount
    }
    return null;
  }

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;

    let agentConfig: AgentConfig;

    if (isWorkflowAgentContext(context)) {
      const stepAgent = context.step.agent;
      if (!stepAgent) {
        throw new Error(
          `No agent config found in step '${context.stepId}'. ` +
          `${this.agentName} plugin requires step.agent with at least image and skill or prompt.`,
        );
      }

      if (!stepAgent.skill && !stepAgent.prompt) {
        throw new Error(
          `Neither skill nor prompt configured in step.agent for step '${context.stepId}'. ` +
          `${this.agentName} plugin requires at least one of step.agent.skill or step.agent.prompt.`,
        );
      }

      if (!stepAgent.image && !isLocalExecutionAllowed()) {
        throw new Error(
          `No Docker image configured in step.agent for step '${context.stepId}'. ` +
          'Local agent execution requires ALLOW_LOCAL_AGENTS=true. ' +
          'Either set step.agent.image for Docker execution, or enable local execution.',
        );
      }

      // Map WorkflowAgentConfig fields to the AgentConfig shape used internally
      agentConfig = {
        model: stepAgent.model,
        skill: stepAgent.skill,
        prompt: stepAgent.prompt,
        skillsDir: stepAgent.skillsDir,
        timeoutMs: stepAgent.timeoutMs ?? (stepAgent.timeoutMinutes ? stepAgent.timeoutMinutes * 60_000 : undefined),
        command: stepAgent.command,
        inlineScript: stepAgent.inlineScript,
        runtime: stepAgent.runtime,
        image: stepAgent.image,
        repo: stepAgent.repo,
        commit: stepAgent.commit,
        dockerfile: stepAgent.dockerfile,
        mcpServers: stepAgent.mcpServers,
        allowedTools: stepAgent.allowedTools,
      };
    } else {
      const stepConfig = context.config.stepConfigs.find(
        (sc: StepConfig) => sc.stepId === context.stepId,
      );

      if (!stepConfig) {
        throw new Error(`Step config not found for stepId '${context.stepId}'`);
      }

      const legacyAgentConfig = stepConfig.agentConfig;
      if (!legacyAgentConfig) {
        throw new Error(
          `No agentConfig found for step '${context.stepId}'. ` +
          `${this.agentName} plugin requires agentConfig with at least image and skill or prompt.`,
        );
      }

      if (!legacyAgentConfig.skill && !legacyAgentConfig.prompt) {
        throw new Error(
          `Neither skill nor prompt configured in agentConfig for step '${context.stepId}'. ` +
          `${this.agentName} plugin requires at least one of agentConfig.skill or agentConfig.prompt.`,
        );
      }

      if (!legacyAgentConfig.image && !isLocalExecutionAllowed()) {
        throw new Error(
          `No Docker image configured in agentConfig for step '${context.stepId}'. ` +
          'Local agent execution requires ALLOW_LOCAL_AGENTS=true. ' +
          'Either set agentConfig.image for Docker execution, or enable local execution.',
        );
      }

      // Wire up stepConfig.timeoutMinutes → agentConfig.timeoutMs if not already set
      if (!legacyAgentConfig.timeoutMs && stepConfig.timeoutMinutes) {
        legacyAgentConfig.timeoutMs = stepConfig.timeoutMinutes * 60_000;
      }

      agentConfig = legacyAgentConfig;
    }

    this.agentConfig = agentConfig;
  }

  async run(emit: EmitFn): Promise<void> {
    const startTime = Date.now();
    const skillName = this.agentConfig.skill ?? 'custom-prompt';
    const timeoutMs = this.agentConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const stepId = this.context.stepId;
    const instanceId = this.context.processInstanceId;

    agentLog('run.start', `${this.agentName} starting`, {
      stepId, instanceId, skillName,
      image: this.agentConfig.image ?? 'local',
      skillsDir: this.agentConfig.skillsDir ?? null,
      MEDIFORCE_ROOT: process.env.MEDIFORCE_ROOT ?? 'NOT_SET',
      cwd: process.cwd(),
    });

    // Resolve env vars from definition-level + step-level env + workflow secrets
    if (isWorkflowAgentContext(this.context)) {
      this.resolvedEnv = resolveStepEnv(
        this.context.workflowDefinition.env,
        this.context.step.env,
        this.context.workflowSecrets,
      );
    } else {
      const stepConfig = this.context.config.stepConfigs.find(
        (s) => s.stepId === this.context.stepId,
      );
      this.resolvedEnv = resolveStepEnv(
        this.context.config.env,
        stepConfig?.env,
      );
    }

    await emit({
      type: 'status',
      payload: `spawning ${this.agentName} with skill '${skillName}'`,
      timestamp: new Date().toISOString(),
    });

    let tempDir: string | null = null;
    let dockerOutputDir: string | null = null;
    let succeeded = false;

    try {
      // Download remote files to local temp dir so the CLI can read them directly
      const { updatedInput, tempDir: downloadedTempDir } = await downloadFilesToLocal(
        this.context.stepInput,
      );
      tempDir = downloadedTempDir;

      if (tempDir) {
        await emit({
          type: 'status',
          payload: `downloaded ${(updatedInput as Record<string, unknown> & { files: FileEntry[] }).files.length} file(s) to local temp directory`,
          timestamp: new Date().toISOString(),
        });
      }

      const isLocalMode = !this.agentConfig.image;
      agentLog('run.mode', `execution mode: ${isLocalMode ? 'local' : 'docker'}`, { stepId });

      // Create output dir early so buildPrompt can write large files into it.
      const rawOutputDir = await mkdtemp(join(tmpdir(), `mediforce-${isLocalMode ? 'local' : 'docker'}-output-`));
      dockerOutputDir = await realpath(rawOutputDir);

      // In Docker mode, the agent sees /output; in local mode, the agent sees the real host path.
      const outputDirForPrompt = isLocalMode ? dockerOutputDir : '/output';

      // Every run gets a shared git worktree via WorkspaceManager — one model, no branches.
      await this.resolveRunWorkspace();
      const workingDirForPrompt = isLocalMode ? this.runWorkspaceHandle!.path : '/workspace';

      // Fetch skills from workflow repo if configured
      if (this.agentConfig.skillsDir && isWorkflowAgentContext(this.context)) {
        const wfRepo = this.context.workflowDefinition.repo;
        if (wfRepo?.url && wfRepo?.commit) {
          const repoToken = resolveRepoToken(this.agentConfig, this.context, this.resolvedEnv.vars);
          await this.fetchSkillsFromRepo(
            this.agentConfig.skillsDir,
            normalizeRepoUrls(wfRepo.url).gitUrl,
            wfRepo.commit,
            repoToken,
          );
        }
      }

      agentLog('run.buildPrompt', 'building prompt', {
        stepId,
        skillsDir: this.agentConfig.skillsDir ?? null,
        resolvedSkillsDir: this.agentConfig.skillsDir ? this.resolveSkillsDir(this.agentConfig.skillsDir, resolveProjectPath) : null,
      });

      const prompt = await this.buildPrompt(updatedInput, timeoutMs, outputDirForPrompt, dockerOutputDir, workingDirForPrompt);

      await emit({
        type: 'prompt',
        payload: prompt,
        timestamp: new Date().toISOString(),
      });

      const options: SpawnCliOptions = { timeoutMs, outputDir: dockerOutputDir };
      if (this.agentConfig.model) options.model = this.agentConfig.model;
      if (tempDir) {
        options.addDirs = [tempDir];
      }

      // Plugin directory — host path to the Claude Code plugin that owns this skill.
      // Convention: `skillsDir` points at `<plugin-root>/skills`; the plugin root
      // (which holds `.claude-plugin/plugin.json`) is its parent directory.
      // Agents that support `--plugin-dir` (Claude Code) pass this along so native
      // skill resolution (SKILL.md + references/) works without workspace pollution.
      if (this.agentConfig.skillsDir) {
        const resolvedSkillsDir = this.resolveSkillsDir(this.agentConfig.skillsDir, resolveProjectPath);
        options.pluginDir = dirname(resolvedSkillsDir);
      }

      // Create activity log file for observability
      const logsDir = join(tmpdir(), 'mediforce-agent-logs');
      await mkdir(logsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = join(logsDir, `${this.context.processInstanceId}_${this.context.stepId}_${timestamp}.log`);
      options.logFile = logFile;

      await emit({
        type: 'status',
        payload: `agent activity log: ${logFile}`,
        timestamp: new Date().toISOString(),
      });

      if (this.agentConfig.mcpServers && this.agentConfig.mcpServers.length > 0) {
        await emit({
          type: 'status',
          payload: `MCP servers: ${this.agentConfig.mcpServers.map((s) => s.name).join(', ')}`,
          timestamp: new Date().toISOString(),
        });
      }

      let spawnResult: SpawnDockerResult;

      if (isLocalMode) {
        console.log(`[${this.agentName}] Spawning LOCAL process: step=${this.context.stepId}`);
        await emit({
          type: 'status',
          payload: `running locally (no Docker) — ALLOW_LOCAL_AGENTS=true`,
          timestamp: new Date().toISOString(),
        });

        try {
          spawnResult = await this.spawnLocalProcess(prompt, options, workingDirForPrompt!);
          console.log(`[${this.agentName}] Local process finished: step=${this.context.stepId}, hasGitMetadata=${!!spawnResult.gitMetadata}, outputLength=${spawnResult.cliOutput.length}`);
        } catch (localErr) {
          console.error(`[${this.agentName}] Local process FAILED: step=${this.context.stepId}`, localErr);
          throw localErr;
        }
      } else {
        const mockLabel = process.env.MOCK_AGENT === 'true' ? ' (MOCK command)' : '';
        console.log(`[${this.agentName}] Spawning Docker container: image=${this.agentConfig.image}, step=${this.context.stepId}${mockLabel}`);
        await emit({
          type: 'status',
          payload: `using Docker container image '${this.agentConfig.image}'${mockLabel}`,
          timestamp: new Date().toISOString(),
        });

        try {
          spawnResult = await this.spawnDockerContainer(prompt, options);
          console.log(`[${this.agentName}] Docker container finished: step=${this.context.stepId}, hasGitMetadata=${!!spawnResult.gitMetadata}, outputLength=${spawnResult.cliOutput.length}`);
        } catch (dockerErr) {
          console.error(`[${this.agentName}] Docker container FAILED: step=${this.context.stepId}`, dockerErr);
          throw dockerErr;
        }
      }

      // Log injected env vars for audit
      if (spawnResult.injectedEnvVars.length > 0) {
        await emit({
          type: 'status',
          payload: `injected env vars: ${spawnResult.injectedEnvVars.join(', ')}`,
          timestamp: new Date().toISOString(),
        });
      } else {
        await emit({
          type: 'status',
          payload: `no env vars injected (local mode — using host auth)`,
          timestamp: new Date().toISOString(),
        });
      }

      const duration_ms = Date.now() - startTime;

      const outputDirMapping = isLocalMode
        ? undefined  // Local mode: paths in prompt are already real host paths
        : spawnResult.outputDir
          ? { containerPath: '/output/', hostPath: spawnResult.outputDir + '/' }
          : undefined;
      const parsedResult = await this.extractResult(spawnResult.cliOutput, outputDirMapping);

      const confidence = typeof parsedResult.confidence === 'number'
        ? parsedResult.confidence
        : 0.7;

      const confidence_rationale = typeof parsedResult.confidence_rationale === 'string'
        ? parsedResult.confidence_rationale
        : undefined;

      // Strip envelope-level fields from result to avoid duplication in UI
      const { confidence: _c, confidence_rationale: _cr, ...cleanResult } = parsedResult;

      // Persist any deliverable file from the output dir before it gets cleaned up
      const deliverableFile = await this.persistDeliverableFile(
        dockerOutputDir ?? spawnResult.outputDir ?? '',
        instanceId,
        this.context.stepId,
      );

      await emit({
        type: 'result',
        payload: {
          confidence,
          ...(confidence_rationale ? { confidence_rationale } : {}),
          reasoning_summary: `${this.agentName} skill '${skillName}' completed successfully`,
          reasoning_chain: [
            `Invoked skill: ${skillName}`,
            `Input keys: ${Object.keys(this.context.stepInput).join(', ')}`,
            tempDir ? `Downloaded files to temp dir` : 'No file downloads needed',
            isLocalMode ? `Local execution (no Docker)` : `Docker container: ${this.agentConfig.image}`,
            spawnResult.injectedEnvVars.length > 0
              ? `Injected env vars: ${spawnResult.injectedEnvVars.join(', ')}`
              : `No env vars injected (local mode)`,
            `Agent: ${this.agentName}`,
            'CLI execution completed',
          ],
          annotations: [],
          model: this.agentConfig.model ?? `${this.agentName}-cli`,
          duration_ms,
          result: cleanResult,
          ...(spawnResult.gitMetadata ? { gitMetadata: spawnResult.gitMetadata } : {}),
          ...(spawnResult.presentation ? { presentation: spawnResult.presentation } : {}),
          ...(deliverableFile ? { deliverableFile } : {}),
        },
        timestamp: new Date().toISOString(),
      });

      succeeded = true;
    } catch (error) {
      const duration_ms = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      agentLog('run.error', errorMessage, {
        stepId, instanceId, skillName, duration_ms,
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5) : undefined,
      });

      // Emit an error event for observability (NOT a result — that would fool the runner
      // into treating a hard failure as a successful completion with confidence 0).
      await emit({
        type: 'error',
        payload: {
          error: errorMessage,
          skill: skillName,
          duration_ms,
        },
        timestamp: new Date().toISOString(),
      });

      // Commit whatever the agent wrote into /workspace before the error —
      // ✗ marker on the run branch so failures are auditable. Best-effort:
      // if this commit itself fails (e.g. worktree corrupt), we swallow that
      // and rethrow the original error.
      if (dockerOutputDir) {
        try {
          await this.commitRunWorkspace(dockerOutputDir, {
            status: 'failed',
            error: errorMessage,
            durationMs: duration_ms,
            agentPlugin: this.agentName,
            agentImage: this.agentConfig.image,
          });
        } catch (commitErr) {
          console.warn(`[${this.agentName}] Failed to commit failure artefacts:`, commitErr);
        }
      }

      // Re-throw so the agent runner's fallback handler deals with the error
      throw error;
    } finally {
      if (succeeded) {
        await cleanupTempDir(tempDir);
      }
      if (dockerOutputDir) {
        await rm(dockerOutputDir, { recursive: true, force: true }).catch(() => {});
      }
      // Worktree is NOT disposed here — steps of the same run re-attach to it.
      // A separate sweeper handles cleanup of worktrees from completed runs (out of v1 scope).
    }
  }

  protected async extractResult(
    cliOutput: string,
    outputDirMapping?: { containerPath: string; hostPath: string },
  ): Promise<Record<string, unknown>> {
    let streamEvent: Record<string, unknown>;
    try {
      streamEvent = JSON.parse(cliOutput) as Record<string, unknown>;
    } catch {
      return { raw: cliOutput };
    }

    const agentText = typeof streamEvent.result === 'string' ? streamEvent.result : null;
    if (!agentText) {
      return streamEvent;
    }

    let contract: AgentOutputContract;
    try {
      contract = JSON.parse(agentText) as AgentOutputContract;
    } catch {
      // Agent text isn't JSON — try reading /output/result.json as fallback
      if (outputDirMapping) {
        try {
          const fallbackPath = join(outputDirMapping.hostPath, 'result.json');
          const fallbackContents = await readFile(fallbackPath, 'utf-8');
          const parsed = JSON.parse(fallbackContents) as Record<string, unknown>;
          return parsed;
        } catch {
          // No result.json either — return raw text
        }
      }
      return { raw: agentText };
    }

    if (contract.output_file) {
      try {
        let filePath = contract.output_file;
        if (outputDirMapping && filePath.startsWith(outputDirMapping.containerPath)) {
          filePath = filePath.replace(outputDirMapping.containerPath, outputDirMapping.hostPath);
        }
        const fileContents = await readFile(filePath, 'utf-8');
        // Try JSON parse; if file is not JSON (e.g. Markdown), return as raw content
        try {
          const parsed = JSON.parse(fileContents) as Record<string, unknown>;
          if (contract.summary) {
            parsed.summary = contract.summary;
          }
          return parsed;
        } catch {
          return { raw: fileContents, output_file: filePath, summary: contract.summary };
        }
      } catch {
        return { raw: agentText, summary: contract.summary };
      }
    }

    return contract as unknown as Record<string, unknown>;
  }

  protected async buildPrompt(
    stepInput?: Record<string, unknown>,
    timeoutMs?: number,
    outputDir?: string,
    hostOutputDir?: string,
    workingDir?: string,
  ): Promise<string> {
    const parts: string[] = [];
    const input = stepInput ?? this.context.stepInput;

    // 0. Workflow-level preamble (domain context, model guidance)
    if (isWorkflowAgentContext(this.context) && this.context.workflowDefinition.preamble) {
      parts.push(this.context.workflowDefinition.preamble);
    }

    // 1. Skill prompt from SKILL.md
    if (this.agentConfig.skill && this.agentConfig.skillsDir) {
      const skillContent = await this.readSkillFile(
        this.resolveSkillsDir(this.agentConfig.skillsDir, resolveProjectPath),
        this.agentConfig.skill,
      );
      parts.push(skillContent);
    }

    // 2. Custom prompt
    if (this.agentConfig.prompt) {
      parts.push(this.agentConfig.prompt);
    }

    // 3. Time budget
    const budgetMs = timeoutMs ?? this.agentConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const budgetMinutes = Math.round(budgetMs / 60_000);
    parts.push(
      `## Time Budget\n` +
      `You have approximately ${budgetMinutes} minutes to complete this task. ` +
      `Budget your time accordingly — prioritize core extraction over validation if time is tight. ` +
      `Do not offer conversational summaries or next steps.`,
    );

    // 3b. Confidence self-assessment instructions
    parts.push(
      `## Confidence Self-Assessment\n` +
      `After completing the task, you MUST include a \`confidence\` field (0.0–1.0) and a \`confidence_rationale\` field (1–2 sentences) in your output JSON.\n\n` +
      `To calibrate your confidence, consider:\n` +
      `- **Input completeness**: Did you receive all necessary data, or were there gaps you had to work around?\n` +
      `- **Output completeness**: Did you address every part of the task, or did you skip/simplify anything?\n` +
      `- **Source reliability**: Were the sources clear and unambiguous, or did you have to interpret/guess?\n` +
      `- **Task difficulty**: Is this a routine case or an edge case with unusual characteristics?\n\n` +
      `Think of confidence as a frequency: "If I handled 100 cases like this, how many times would my output be correct?"\n` +
      `- 0.95+ → Routine case, complete data, high certainty. ~5 or fewer errors per 100.\n` +
      `- 0.80–0.95 → Minor gaps or ambiguities, but overall solid. ~5–20 errors per 100.\n` +
      `- 0.50–0.80 → Significant uncertainty — missing data, ambiguous sources, or unusual case. ~20–50 errors per 100.\n` +
      `- Below 0.50 → Major issues — guesswork involved, recommend human review.\n\n` +
      `The \`confidence_rationale\` must explain WHY you chose that number. Examples:\n` +
      `- "0.95 — Routine extraction from well-structured data. All required fields present, no ambiguities."\n` +
      `- "0.72 — Supplier X pricing data was missing; interpolated from similar category. In ~3/10 similar cases this interpolation would be off by >10%."\n` +
      `- "0.40 — Source document was a low-quality scan with multiple illegible sections. Significant guesswork on 3 out of 8 fields."`,
    );

    // 4. Workspace + result contract directories (unified — every run has a git worktree).
    if (workingDir && outputDir) {
      parts.push(
        `## Workspace Directory (Git Worktree)\n` +
        `Your workspace is at: ${workingDir}\n` +
        `Write ALL deliverable files here — R scripts, data files, specs, reports, etc.\n` +
        `Use subdirectories like ${workingDir}/code/ and ${workingDir}/data/ as appropriate.\n` +
        `Everything in this directory will be committed on step completion.\n` +
        `Whenever the skill instructions reference {output_dir}, use ${workingDir} instead.\n` +
        `You MUST use full absolute paths when calling Write. Relative paths will be rejected.`,
      );
      parts.push(
        `## Result Contract Directory\n` +
        `Write ONLY the output result contract JSON to: ${outputDir}/result.json\n` +
        `Do NOT write deliverable files to ${outputDir} — they will not be committed.\n` +
        `The ${outputDir} directory is for the result contract and temporary/intermediate files only.`,
      );
    }

    // 5. Input context
    const previousOutputs = await this.context.getPreviousStepOutputs();
    const hasPreviousOutputs = Object.keys(previousOutputs).length > 0;
    const INLINE_THRESHOLD = 5_000; // characters — shared by both previous-run and previous-step spill logic

    parts.push('## Input Data');
    parts.push(JSON.stringify(input, null, 2));

    // 5b. Previous run outputs — carry-over snapshot from the last successful
    // run of this workflow (see WD.inputForNextRun). Distinct from "previous
    // step outputs" (same run). Reuse the same inline-or-spill pattern as
    // below so a workflow that inadvertently carries a large payload doesn't
    // balloon the prompt and token cost silently.
    if (isWorkflowAgentContext(this.context) && this.context.previousRun !== undefined) {
      parts.push(
        '## Previous Run Outputs\n' +
        'Values carried over from the last successfully completed run of this ' +
        'workflow, per the workflow definition\'s `inputForNextRun` declaration. ' +
        '`{}` means no predecessor qualified (first run, all previous failed, ' +
        'or chain reset). Use this to resume where the previous run left off ' +
        '(e.g. a cursor, last-seen hash, etc.).',
      );

      const previousRun = this.context.previousRun;
      if (outputDir) {
        const inlinePreviousRun: Record<string, unknown> = {};
        const previousRunFileRefs: { field: string; containerPath: string }[] = [];

        for (const [key, value] of Object.entries(previousRun)) {
          const serialized = typeof value === 'string' ? value : JSON.stringify(value);
          if (serialized.length > INLINE_THRESHOLD) {
            const writeDir = hostOutputDir ?? outputDir;
            const ext = typeof value === 'string' && !value.trimStart().startsWith('{') ? '.md' : '.json';
            const filename = `prevrun-${key}${ext}`;
            const hostPath = join(writeDir, filename);
            await writeFile(hostPath, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf-8');
            const agentFilePath = `${outputDir}/${filename}`;
            previousRunFileRefs.push({ field: key, containerPath: agentFilePath });
            inlinePreviousRun[key] = `[FILE: ${agentFilePath}]`;
          } else {
            inlinePreviousRun[key] = value;
          }
        }

        parts.push(JSON.stringify(inlinePreviousRun, null, 2));

        if (previousRunFileRefs.length > 0) {
          parts.push(
            '## Large Previous Run Files\n' +
            'Some previous run values were too large to include inline. ' +
            `They have been written to files in ${outputDir}/. Read them with \`cat\` or your preferred tool:\n` +
            previousRunFileRefs.map((r) => `- **${r.field}**: \`${r.containerPath}\``).join('\n'),
          );
        }
      } else {
        // No outputDir available (e.g. local-mode without disk) — inline verbatim.
        parts.push(JSON.stringify(previousRun, null, 2));
      }
    }

    // 6. Previous step outputs — write large values to files instead of inlining
    if (hasPreviousOutputs && outputDir) {
      const inlineOutputs: Record<string, unknown> = {};
      const fileRefs: { stepId: string; field: string; containerPath: string }[] = [];

      for (const [stepId, stepOutput] of Object.entries(previousOutputs)) {
        if (typeof stepOutput !== 'object' || stepOutput === null) {
          inlineOutputs[stepId] = stepOutput;
          continue;
        }
        const record = stepOutput as Record<string, unknown>;
        const compactOutput: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(record)) {
          const serialized = typeof value === 'string' ? value : JSON.stringify(value);
          if (serialized.length > INLINE_THRESHOLD) {
            // Write to file — use hostOutputDir (real disk path) when available,
            // fall back to outputDir (which may be a container path like /output)
            const writeDir = hostOutputDir ?? outputDir;
            const ext = typeof value === 'string' && !value.trimStart().startsWith('{') ? '.md' : '.json';
            const filename = `prev-${stepId}-${key}${ext}`;
            const hostPath = join(writeDir, filename);
            await writeFile(hostPath, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf-8');
            const agentFilePath = `${outputDir}/${filename}`;
            fileRefs.push({ stepId, field: key, containerPath: agentFilePath });
            compactOutput[key] = `[FILE: ${agentFilePath}]`;
          } else {
            compactOutput[key] = value;
          }
        }
        inlineOutputs[stepId] = compactOutput;
      }

      parts.push('## Previous Step Outputs');
      parts.push(JSON.stringify(inlineOutputs, null, 2));

      if (fileRefs.length > 0) {
        parts.push(
          '## Large Output Files\n' +
          'Some previous step outputs were too large to include inline. ' +
          `They have been written to files in ${outputDir}/. Read them with \`cat\` or your preferred tool:\n` +
          fileRefs.map((r) => `- **${r.stepId}.${r.field}**: \`${r.containerPath}\``).join('\n'),
        );
      }
    } else if (hasPreviousOutputs) {
      parts.push('## Previous Step Outputs');
      parts.push(JSON.stringify(previousOutputs, null, 2));
    }

    return parts.join('\n\n');
  }

  protected async readSkillFile(skillsDir: string, skill: string): Promise<string> {
    const skillPath = join(skillsDir, skill, 'SKILL.md');
    agentLog('readSkillFile', `reading ${skillPath}`, { skillsDir, skill });
    try {
      const raw = await readFile(skillPath, 'utf-8');
      agentLog('readSkillFile', `success — ${raw.length} chars`, { skillPath });
      return stripFrontmatter(raw);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new Error(
          `Skill file not found: ${skillPath}\n` +
          `Resolved from skillsDir="${skillsDir}", skill="${skill}"\n` +
          `Project root: ${MONOREPO_ROOT} (MEDIFORCE_ROOT=${process.env.MEDIFORCE_ROOT ?? 'NOT_SET'})`,
        );
      }
      throw err;
    }
  }

  protected async spawnLocalProcess(
    prompt: string,
    options: SpawnCliOptions,
    workingDir: string,
  ): Promise<SpawnDockerResult> {
    const outputDir = options.outputDir!;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const logFile = options.logFile ?? null;

    // Write prompt to file for debugging and 'file' delivery mode
    const promptFilePath = join(outputDir, 'prompt.txt');
    await writeFile(promptFilePath, prompt, 'utf-8');

    await this.prepareOutputDir(outputDir);
    // Workspace (git worktree) is already set up by run() → resolveRunWorkspace; nothing to do here.

    // --- Spawn the agent CLI ---
    const commandSpec = this.getAgentCommand(promptFilePath, options);

    const cliOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn(commandSpec.args[0], commandSpec.args.slice(1), {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...this.resolvedEnv.vars,
          ...this.getLocalInternalEnvVars(outputDir),
        },
      });

      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        console.error(`[${this.agentName}] Local process timeout (${Math.round(timeoutMs / 60_000)} min) — killing`);
        child.kill('SIGTERM');
        // Give the process a moment to clean up, then force kill
        setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000);
      }, timeoutMs);

      const rawLines: string[] = [];
      let buffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          rawLines.push(trimmed);

          if (logFile) {
            const logEntries = this.processOutputLine(trimmed);
            if (logEntries.length > 0) {
              appendFile(logFile, logEntries.join('\n') + '\n').catch(() => {});
            }
          }
        }
      });

      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('error', (error) => {
        reject(new Error(`Local process failed: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        settled = true;
        clearTimeout(timeoutHandle);

        if (buffer.trim()) {
          rawLines.push(buffer.trim());
          if (logFile) {
            const logEntries = this.processOutputLine(buffer.trim());
            if (logEntries.length > 0) {
              appendFile(logFile, logEntries.join('\n') + '\n').catch(() => {});
            }
          }
        }

        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        const timeoutMinutes = Math.round(timeoutMs / 60_000);

        const rawStdout = rawLines.join('\n');
        const finalResult = this.parseAgentOutput(rawStdout);

        if (code !== 0) {
          const exitInfo = signal
            ? `killed by ${signal}${signal === 'SIGTERM' ? ` (likely timeout — ${timeoutMinutes} min limit)` : ''}`
            : `exit code ${code}`;
          const detail = this.extractErrorFromResult(finalResult) || stderr || 'no stderr output';
          reject(new Error(`Local process failed (${exitInfo}): ${detail}`));
          return;
        }

        if (!finalResult) {
          this.recoverOutputFromDirectory(outputDir)
            .then((recovered) => resolve(recovered))
            .catch(() => {
              reject(new Error('Local process produced no result event and no files found in output directory'));
            });
          return;
        }

        resolve(finalResult);
      });

      // Deliver prompt
      if (commandSpec.promptDelivery === 'stdin') {
        child.stdin.write(prompt);
      }
      child.stdin.end();
    });

    const gitMetadata = await this.commitRunWorkspace(outputDir, {
      status: 'success',
      agentPlugin: this.agentName,
      agentImage: this.agentConfig.image,
    });

    // Read presentation.html from local output directory
    let localPresentation: string | null = null;
    try {
      localPresentation = await readFile(join(outputDir, 'presentation.html'), 'utf-8');
    } catch {
      // presentation.html is optional
    }

    return { cliOutput, gitMetadata, presentation: localPresentation, outputDir, injectedEnvVars: [] };
  }

  protected async spawnDockerContainer(
    prompt: string,
    options?: SpawnCliOptions,
  ): Promise<SpawnDockerResult> {
    const image = this.agentConfig.image;

    if (!image) {
      throw new Error(`agentConfig.image is required for Docker container execution`);
    }
    if (!this.runWorkspaceHandle) {
      throw new Error('runWorkspaceHandle is not set — resolveRunWorkspace() must run before spawnDockerContainer()');
    }

    const imageBuild = resolveImageBuild(image, this.agentConfig, this.context, this.resolvedEnv.vars);

    // Merge config-driven env vars with plugin-internal env vars
    const internalVars = this.getInternalEnvVars();
    const envVars = { ...this.resolvedEnv.vars, ...internalVars };
    const injectedEnvVars = this.resolvedEnv.injectedKeys;

    // Use pre-created output dir from options, or create one
    let outputDir: string;
    if (options?.outputDir) {
      outputDir = options.outputDir;
    } else {
      const rawOutputDir = await mkdtemp(join(tmpdir(), 'mediforce-docker-output-'));
      outputDir = await realpath(rawOutputDir);
    }

    // Write prompt to file — used for 'file' delivery mode and as debugging aid
    const promptFilePath = join(outputDir, 'prompt.txt');
    await writeFile(promptFilePath, prompt, 'utf-8');

    // Let subclass write additional files (e.g. agent config) to the output dir
    await this.prepareOutputDir(outputDir);

    const isMockAgent = process.env.MOCK_AGENT === 'true';

    const processInstanceId = this.context.processInstanceId;
    const stepId = this.context.stepId;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const logFile = options?.logFile ?? null;

    // Build docker run args
    const containerName = `mediforce-${processInstanceId}-${stepId}`.slice(0, 63);
    const dockerArgs: string[] = [
      'run', '--rm', '-i',
      '--name', containerName,
      '--memory', '4g',
      '--cpus', '2',
      '-v', `${outputDir}:/output`,
    ];

    // Inject agent-specific env vars
    for (const [key, value] of Object.entries(envVars)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }

    // /workspace: bind-mount the host run worktree (read-write)
    dockerArgs.push(
      '-v', `${this.runWorkspaceHandle.path}:/workspace`,
      '-w', '/workspace',
    );

    // Bind-mount the Claude Code plugin root (read-only) when skillsDir is configured.
    // The host `options.pluginDir` becomes `${CONTAINER_PLUGIN_MOUNT}` inside the container;
    // we rewrite the options before getAgentCommand so the agent always receives the path
    // it will actually see (no Docker-vs-local branching in subclass code).
    const containerOptions: SpawnCliOptions = { ...options };
    if (options?.pluginDir) {
      dockerArgs.push('-v', `${options.pluginDir}:${CONTAINER_PLUGIN_MOUNT}:ro`);
      containerOptions.pluginDir = CONTAINER_PLUGIN_MOUNT;
    }

    // Mount data directory if files were downloaded
    if (options?.addDirs) {
      for (const dir of options.addDirs) {
        dockerArgs.push('-v', `${dir}:/data:ro`);
      }
    }

    // In mock mode, mount fixtures + data so the container copies real output files
    if (isMockAgent) {
      const mockFixturesDir = this.getMockFixturesDir();
      if (mockFixturesDir) {
        dockerArgs.push('-v', `${mockFixturesDir}:/mock-fixtures:ro`);
      }
      const mockDataDir = await this.getMockDataDir();
      if (mockDataDir) {
        dockerArgs.push('-v', `${mockDataDir}:/mock-data:ro`);
      }
    }

    dockerArgs.push(image);

    let promptViaStdin = false;
    if (isMockAgent) {
      dockerArgs.push(...this.getMockDockerArgs(stepId));
    } else {
      const commandSpec = this.getAgentCommand('/output/prompt.txt', containerOptions);
      dockerArgs.push(...commandSpec.args);
      promptViaStdin = commandSpec.promptDelivery === 'stdin';
    }

    // Delegate container execution to the spawn strategy.
    // LocalDockerSpawnStrategy: direct child process (default, same as before)
    // QueuedDockerSpawnStrategy: enqueues to BullMQ worker (when REDIS_URL is set)
    const strategy = getDockerSpawnStrategy();
    const spawnResult = await strategy.spawn({
      dockerArgs,
      stdinPayload: (!isMockAgent && promptViaStdin) ? prompt : null,
      timeoutMs,
      containerName,
      processInstanceId,
      stepId,
      outputDir,
      logFile,
      imageBuild,
      // Pass lineProcessor so LocalDockerSpawnStrategy writes JSONL entries in real-time.
      // QueuedDockerSpawnStrategy ignores this (can't pass functions through Redis).
      lineProcessor: (line) => this.processOutputLine(line),
    });

    // Build rawLines for parseAgentOutput. For LocalDockerSpawnStrategy the log file was
    // already written in real-time via lineProcessor; for QueuedDockerSpawnStrategy we
    // do a batch write here since the worker cannot use the callback.
    const isQueuedStrategy = Boolean(process.env.REDIS_URL);
    const rawLines: string[] = [];
    for (const line of spawnResult.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      rawLines.push(trimmed);

      if (logFile && isQueuedStrategy) {
        const logEntries = this.processOutputLine(trimmed);
        if (logEntries.length > 0) {
          await appendFile(logFile, logEntries.join('\n') + '\n');
        }
      }
    }

    const rawStdout = rawLines.join('\n');
    const finalResult = this.parseAgentOutput(rawStdout);
    const timeoutMinutes = Math.round(timeoutMs / 60_000);

    if (spawnResult.exitCode !== 0) {
      const exitInfo = spawnResult.signal
        ? `killed by ${spawnResult.signal}${spawnResult.signal === 'SIGTERM' ? ` (likely timeout — ${timeoutMinutes} min limit)` : ''}`
        : `exit code ${spawnResult.exitCode}`;
      const detail = this.extractErrorFromResult(finalResult) || spawnResult.stderr.trim() || 'no stderr output';
      throw new Error(`Docker container failed (${exitInfo}): ${detail}`);
    }

    let cliOutput: string;
    if (finalResult) {
      cliOutput = finalResult;
    } else {
      // Agent wrote files but never emitted a text response with the contract
      // (common with some models like Gemini Flash Lite that stop after tool calls).
      // Fallback: try result.json first, then scan /output/ for any written files.
      cliOutput = await this.recoverOutputFromDirectory(outputDir);
    }

    const gitMetadata = await this.commitRunWorkspace(outputDir, {
      status: 'success',
      agentPlugin: this.agentName,
      agentImage: this.agentConfig.image,
    });

    // Read presentation.html from the output directory (optional agent-provided HTML view)
    let presentation: string | null = null;
    try {
      presentation = await readFile(join(outputDir, 'presentation.html'), 'utf-8');
    } catch {
      // presentation.html is optional — agents may not produce one
    }

    return { cliOutput, gitMetadata, presentation, outputDir, injectedEnvVars };
  }
}
