import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type AgentLogFormat, type PluginCapabilityMetadata, normaliseModelId } from '@mediforce/platform-core';
export { normaliseModelId };
import {
  BaseContainerAgentPlugin,
  DEFAULT_STDIO_MCP_TIMEOUT_MS,
  type McpConfigEntry,
  type McpServerStatus,
  type SpawnCliOptions,
  type AgentCommandSpec,
} from './base-container-agent-plugin';
import { isWorkflowAgentContext } from './container-plugin';

/** Default model used when agentConfig.model is not set. */
const OPENCODE_DEFAULT_MODEL = 'deepseek/deepseek-chat';

const OPENCODE_ERROR_PREFIX = '[OpenCode error] ';

/** An `mcp` entry in opencode.json (https://opencode.ai/docs/mcp-servers/). */
type OpenCodeMcpEntry =
  | { type: 'local'; command: string[]; environment?: Record<string, string>; timeout: number }
  | { type: 'remote'; url: string; headers?: Record<string, string>; oauth: false };

type OpenCodePermission = 'allow' | Record<string, 'allow' | 'deny'>;

/** The platform's resolved MCP servers as opencode.json entries. `timeout` is
 *  how long OpenCode waits for a local server to connect (its default: 30s).
 *  OAuth discovery is off: the platform already rendered the auth header. */
function toOpenCodeMcp(servers: Record<string, McpConfigEntry>, localTimeoutMs: number): Record<string, OpenCodeMcpEntry> {
  const entries: Record<string, OpenCodeMcpEntry> = {};
  for (const [name, server] of Object.entries(servers)) {
    entries[name] = server.type === 'stdio'
      ? {
        type: 'local',
        command: [server.command, ...(server.args ?? [])],
        ...(server.env !== undefined ? { environment: server.env } : {}),
        timeout: localTimeoutMs,
      }
      : {
        type: 'remote',
        url: server.url,
        ...(server.headers !== undefined ? { headers: server.headers } : {}),
        oauth: false,
      };
  }
  return entries;
}

/** OpenCode spells an MCP tool `<server>_<tool>`, each part with anything
 *  outside [A-Za-z0-9_-] replaced by `_`. A `*` stays, as the glob it is in an
 *  allowedTools entry. */
function openCodeToolNamePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_*-]/g, '_');
}

/** Every tool allowed, except a binding's MCP tools it does not list. A denied
 *  tool is never offered to the model. Of the rules matching a tool the last
 *  one wins, so a server's rules follow those of any shorter-named server whose
 *  wildcard also matches its tools (`github_*` matches `github_enterprise_x`),
 *  and its listed tools follow its own wildcard. */
function toolPermissions(servers: Record<string, McpConfigEntry>): OpenCodePermission {
  const restricted = Object.values(servers).some((server) => (server.allowedTools?.length ?? 0) > 0);
  if (restricted === false) return 'allow';
  const rules: Record<string, 'allow' | 'deny'> = { '*': 'allow' };
  const entries = Object.entries(servers).map(([name, server]) => ({
    name,
    prefix: openCodeToolNamePart(name),
    allowedTools: server.allowedTools ?? [],
  }));
  const nameByPrefix = new Map<string, string>();
  for (const { name, prefix } of entries) {
    const clashingName = nameByPrefix.get(prefix);
    if (clashingName !== undefined) {
      throw new Error(
        `MCP servers "${clashingName}" and "${name}" both become OpenCode tool prefix "${prefix}_", so allowedTools cannot tell their tools apart. Rename one.`,
      );
    }
    nameByPrefix.set(prefix, name);
  }
  const byPrefixLength = entries
    .sort((left, right) => left.prefix.length - right.prefix.length);
  for (const { prefix, allowedTools } of byPrefixLength) {
    rules[`${prefix}_*`] = allowedTools.length > 0 ? 'deny' : 'allow';
    for (const tool of allowedTools) {
      rules[`${prefix}_${openCodeToolNamePart(tool)}`] = 'allow';
    }
  }
  return rules;
}

/** The MCP servers OpenCode's log shows never connected. OpenCode reports MCP
 *  status nowhere in its `--format json` output, only in its log (INFO level by
 *  default). From 1.17 a failed server gets a `"server unavailable"` line; 1.15
 *  logs a `found` line per server and `successfully created client` for each
 *  one that connected. */
export function failedMcpServersInLog(openCodeLog: string): string[] {
  const failed: string[] = [];
  const found: string[] = [];
  const connected = new Set<string>();
  for (const line of openCodeLog.split('\n')) {
    const unavailable = /message="server unavailable" key=(\S+)/.exec(line);
    if (unavailable !== null) failed.push(unavailable[1]);
    const foundMatch = /service=mcp key=(\S+) type=\S+ found$/.exec(line.trim());
    if (foundMatch !== null) found.push(foundMatch[1]);
    const connectedMatch = /service=mcp key=(\S+) .*create\(\) successfully created client/.exec(line);
    if (connectedMatch !== null) connected.add(connectedMatch[1]);
  }
  return [...new Set([...failed, ...found.filter((server) => connected.has(server) === false)])];
}

/**
 * OpenCode agent plugin — runs the OpenCode CLI inside a Docker container.
 *
 * OpenCode supports multiple LLM providers including local models via Ollama,
 * making it suitable for cost-effective UAT runs and privacy-sensitive workloads.
 *
 * CLI invocation: `opencode run "$(cat /output/prompt.txt)" --format json`
 * JSON output:    JSONL stream with type "text" events containing the response.
 */
export class OpenCodeAgentPlugin extends BaseContainerAgentPlugin {
  readonly agentName = 'OpenCode';

  readonly metadata: PluginCapabilityMetadata = {
    name: 'OpenCode Agent',
    description:
      'AI coding agent powered by OpenCode CLI. ' +
      'Supports multiple LLM providers including local models via Ollama. ' +
      'Executes configurable skills driven by SKILL.md prompts and structured input data.',
    inputDescription:
      'Any structured JSON context: file paths, previous step outputs, domain data. ' +
      'Adapts to the configured skill.',
    outputDescription:
      'Skill-dependent structured JSON with confidence scoring. ' +
      'Examples: extracted metadata, generated code, analysis reports.',
    roles: ['executor'],
    foundationModel: 'DeepSeek Chat',
    requiredEnv: [['OPENROUTER_API_KEY']],
  };

  protected override getInternalEnvVars(): Record<string, string> {
    return {
      // OpenCode reads config from OPENCODE_CONFIG env var.
      OPENCODE_CONFIG: '/output/opencode.json',
      // XDG override so OpenCode writes auth.json where we mount it
      XDG_DATA_HOME: '/output/.local/share',
    };
  }

  /** OpenCode passes MCP_TIMEOUT on as each local server's `timeout`, but its
   *  MCP SDK gives up on a handshake after 60s whatever it says — below the
   *  120s default, so raising MCP_TIMEOUT never helps here. */
  protected override mcpStartupHint(server: string): string {
    if (super.mcpStartupHint(server) === '') return '';
    return ' OpenCode waits at most 60s for a server to start, so a slower one has to be installed in the image.';
  }

  protected override async mcpServerStatus(_rawStdout: string, outputDir: string): Promise<McpServerStatus> {
    // XDG_DATA_HOME points into the output dir (getInternalEnvVars), so the log lands there.
    const logDir = join(outputDir, '.local', 'share', 'opencode', 'log');
    let logFiles: string[];
    try {
      logFiles = (await readdir(logDir)).filter((name) => name.endsWith('.log'));
    } catch {
      return { failed: [], pending: [] };
    }
    const logs = await Promise.all(logFiles.map((name) => readFile(join(logDir, name), 'utf-8')));
    return { failed: failedMcpServersInLog(logs.join('\n')), pending: [] };
  }

  protected override extractErrorFromResult(resultLine: string): string | null {
    if (!resultLine) return null;
    try {
      const { result, errors } = JSON.parse(resultLine) as { result?: unknown; errors?: unknown };
      if (Array.isArray(errors) && errors.length > 0) {
        return errors.join('\n').slice(0, 500);
      }
      if (typeof result === 'string' && result.startsWith(OPENCODE_ERROR_PREFIX)) {
        return result.replaceAll(OPENCODE_ERROR_PREFIX, '').slice(0, 500);
      }
    } catch {
      // not valid JSON
    }
    return null;
  }

  protected override getLocalInternalEnvVars(outputDir: string): Record<string, string> {
    const absOutputDir = resolve(outputDir);
    return {
      OPENCODE_CONFIG: join(absOutputDir, 'opencode.json'),
      XDG_DATA_HOME: join(absOutputDir, '.local', 'share'),
    };
  }

  getAgentCommand(promptFilePath: string, _options?: SpawnCliOptions): AgentCommandSpec {
    // OpenCode CLI: `opencode run <message> --format json`
    // For long prompts, we read from the prompt file using $(cat ...) to avoid
    // shell argument length limits on the docker run command itself.
    // The expansion happens inside the container's bash, where ARG_MAX is ~2MB.
    const model = this.agentConfig.model ?? OPENCODE_DEFAULT_MODEL;

    // OpenCode's --model flag format is "providerID/modelID" — the first path
    // segment is the provider, the rest is the model ID within that provider.
    // "deepseek/deepseek-chat" means provider=deepseek, model=deepseek-chat.
    // When routing through OpenRouter, we must prefix with "openrouter/" so
    // OpenCode resolves provider=openrouter, model=deepseek/deepseek-chat.
    const modelArg = this.resolveModelArg(model);

    const args = [
      'bash', '-c',
      `opencode run "$(cat ${promptFilePath})" --format json --model ${modelArg}`,
    ];

    return { args, promptDelivery: 'file' };
  }

  /** Build the full provider/model string for the --model CLI flag. */
  private resolveModelArg(model: string): string {
    // Normalise legacy Firestore-encoded IDs: "deepseek__deepseek-chat"
    // → "deepseek/deepseek-chat".  Firestore doc IDs can't contain "/",
    // so the model registry used "__" as separator; Postgres has no such
    // limitation but old IDs may still exist in workflow definitions.
    const normalised = normaliseModelId(model);

    if (normalised.startsWith('openrouter/') || !normalised.includes('/')) {
      return normalised;
    }
    const workflowSecrets = isWorkflowAgentContext(this.context)
      ? this.context.workflowSecrets
      : undefined;
    const openrouterKey = this.resolvedEnv.vars.OPENROUTER_API_KEY ?? workflowSecrets?.OPENROUTER_API_KEY;
    if (openrouterKey) {
      return `openrouter/${normalised}`;
    }
    return normalised;
  }

  getMockDockerArgs(stepId: string): string[] {
    const copyOutputCmd =
      `cp -r /mock-data/* /output/ 2>/dev/null; ` +
      `if [ -f "/mock-fixtures/${stepId}.json" ]; then ` +
        `cp /mock-fixtures/${stepId}.json /output/mock-result.json && ` +
        `echo "[mock-opencode] step=${stepId}: copied data + fixture" >&2; ` +
      `else ` +
        `echo '{"mock":true,"summary":"Mock OpenCode output for step ${stepId}"}' > /output/mock-result.json && ` +
        `echo "[mock-opencode] step=${stepId}: no fixture, generic mock" >&2; ` +
      `fi`;

    const copyWorkspaceCmd =
      `WSDIR=$(grep -o '"_workspaceDir"[[:space:]]*:[[:space:]]*"[^"]*"' /mock-fixtures/${stepId}.json 2>/dev/null | sed 's/.*"\\([^"]*\\)"$/\\1/'); ` +
      `if [ -n "$WSDIR" ] && [ -d "/mock-data/$WSDIR" ]; then ` +
        `cp -r /mock-data/$WSDIR/* /workspace/ && ` +
        `echo "[mock-opencode] step=${stepId}: copied $WSDIR/ into /workspace/" >&2; ` +
      `fi`;

    const mockAgentResponse = JSON.stringify({
      output_file: '/output/mock-result.json',
      summary: `Mock OpenCode output for step ${stepId}`,
    });
    const mockOpenCodeJson = JSON.stringify({ type: 'text', part: { type: 'text', text: mockAgentResponse } });

    return [
      'bash', '-c',
      `${copyOutputCmd} && ${copyWorkspaceCmd}; ` +
      `echo '${mockOpenCodeJson.replace(/'/g, "'\\''")}'`,
    ];
  }

  protected override readonly logFormat: AgentLogFormat = 'opencode-jsonl';
  protected override readonly loadsAgentSkills = true;

  parseAgentOutput(rawStdout: string): string {
    // OpenCode with --format json outputs JSONL events.
    // Text events: { "type": "text", "part": { "text": "..." } }
    //
    // The model emits many text events (narration at each step) but only the
    // LAST one contains the contract JSON ({"output_file":...,"summary":...}).
    // We scan text parts in reverse to find it.
    const lines = rawStdout.trim().split('\n');
    const textParts: string[] = [];
    const errors: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    // Each step_finish's `tokens.input` is the full prompt for that turn, so the
    // running context peaks on the last/largest turn. The max (not the sum) is
    // what measures context saturation against the model's window.
    let peakInputTokens = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          part?: {
            type?: string;
            text?: string;
            cost?: number;
            tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
          };
          error?: { name?: string; data?: { message?: string } };
        };

        if (event.type === 'text' && typeof event.part?.text === 'string') {
          textParts.push(event.part.text);
        }

        if (event.type === 'step_finish' && event.part?.tokens) {
          const turnTokens = event.part.tokens;
          totalInputTokens += turnTokens.input ?? 0;
          totalOutputTokens += turnTokens.output ?? 0;
          // Context occupancy for the turn is the whole prompt, not just the
          // uncached portion: with prompt caching on, `input` excludes cached
          // tokens (`cache.read`/`cache.write`), so peak must sum all three or
          // it under-reports saturation by orders of magnitude.
          const turnPromptTokens = (turnTokens.input ?? 0) + (turnTokens.cache?.read ?? 0) + (turnTokens.cache?.write ?? 0);
          peakInputTokens = Math.max(peakInputTokens, turnPromptTokens);
        }

        if (event.type === 'error' && event.error?.data?.message) {
          errors.push(event.error.data.message);
        }
      } catch {
        // Skip non-JSON lines (Docker/entrypoint output)
      }
    }

    if (textParts.length === 0 && errors.length === 0) {
      return '';
    }

    // Errors travel beside the result so a mid-run failure survives later text events.
    const errorsField = errors.length > 0 ? { errors } : {};
    const usage = (totalInputTokens > 0 || totalOutputTokens > 0)
      ? {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          ...(peakInputTokens > 0 ? { peak_input_tokens: peakInputTokens } : {}),
        }
      : undefined;

    // Find the contract JSON in text parts (scan from last to first).
    // The contract is: {"output_file": "...", "summary": "..."}
    // The model may wrap it in narration text, so extract just the JSON object.
    for (let index = textParts.length - 1; index >= 0; index--) {
      const part = textParts[index].trim();
      if (part.includes('"output_file"') || part.includes('"summary"')) {
        // Extract the JSON object from the text (model may add preamble/postamble)
        const jsonMatch = part.match(/\{[^{}]*"output_file"[^{}]*\}/);
        const contractJson = jsonMatch ? jsonMatch[0] : part;
        return JSON.stringify({ result: contractJson, ...errorsField, ...(usage ? { usage } : {}) });
      }
    }

    // Fallback: use the last text part (most likely the final response)
    if (textParts.length > 0) {
      return JSON.stringify({ result: textParts[textParts.length - 1], ...errorsField, ...(usage ? { usage } : {}) });
    }

    // Only errors
    return JSON.stringify({ result: errors.map((e) => `${OPENCODE_ERROR_PREFIX}${e}`).join('\n'), ...errorsField, ...(usage ? { usage } : {}) });
  }

  protected override async writeAgentConfig(outputDir: string, agentOptions?: SpawnCliOptions): Promise<void> {
    const model = normaliseModelId(this.agentConfig.model ?? OPENCODE_DEFAULT_MODEL);
    const mcpServers = await this.buildMcpServers(outputDir);
    const config: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      permission: toolPermissions(mcpServers),
    };
    if (Object.keys(mcpServers).length > 0) {
      config.mcp = toOpenCodeMcp(mcpServers, this.localMcpTimeoutMs());
    }
    if (agentOptions?.pluginDir !== undefined) {
      // The plugin root holds the step's and the agent's skills, one folder each.
      config.skills = { paths: [join(agentOptions.pluginDir, 'skills')] };
    }

    const workflowSecrets = isWorkflowAgentContext(this.context)
      ? this.context.workflowSecrets
      : undefined;

    const openrouterKey = this.resolvedEnv.vars.OPENROUTER_API_KEY ?? workflowSecrets?.OPENROUTER_API_KEY;
    const deepseekKey = this.resolvedEnv.vars.DEEPSEEK_API_KEY ?? workflowSecrets?.DEEPSEEK_API_KEY;

    if (openrouterKey && model.includes('/')) {
      config.provider = { openrouter: { models: { [model]: {} } } };
    } else if (deepseekKey && model.startsWith('deepseek/')) {
      config.provider = { deepseek: { models: { [model]: {} } } };
    }

    const configPath = join(outputDir, 'opencode.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Write auth.json so OpenCode can authenticate with the provider.
    const auth: Record<string, { type: string; key: string }> = {};

    if (deepseekKey) {
      auth.deepseek = { type: 'api', key: deepseekKey };
    }
    if (openrouterKey) {
      auth.openrouter = { type: 'api', key: openrouterKey };
    }

    if (Object.keys(auth).length > 0) {
      const authDir = join(outputDir, '.local', 'share', 'opencode');
      await mkdir(authDir, { recursive: true });
      const authPath = join(authDir, 'auth.json');
      await writeFile(authPath, JSON.stringify(auth), 'utf-8');
    }
  }

  /** `MCP_TIMEOUT` from the step env when it is a positive whole number of ms,
   *  so the knob is the same one a Claude Code step uses. */
  private localMcpTimeoutMs(): number {
    const configured = Number(this.resolvedEnv.vars.MCP_TIMEOUT);
    return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_STDIO_MCP_TIMEOUT_MS;
  }
}
