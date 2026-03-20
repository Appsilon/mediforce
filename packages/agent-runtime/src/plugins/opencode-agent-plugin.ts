import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import {
  BaseContainerAgentPlugin,
  type SpawnCliOptions,
  type AgentCommandSpec,
} from './base-container-agent-plugin.js';

/** Default model used when agentConfig.model is not set. */
const DEFAULT_MODEL = 'deepseek/deepseek-chat';

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
  };

  protected override getInternalEnvVars(): Record<string, string> {
    return {
      // OpenCode reads config from OPENCODE_CONFIG env var.
      OPENCODE_CONFIG: '/output/opencode.json',
      // XDG override so OpenCode writes auth.json where we mount it
      XDG_DATA_HOME: '/output/.local/share',
    };
  }

  getAgentCommand(promptFilePath: string, _options?: SpawnCliOptions): AgentCommandSpec {
    // OpenCode CLI: `opencode run <message> --format json`
    // For long prompts, we read from the prompt file using $(cat ...) to avoid
    // shell argument length limits on the docker run command itself.
    // The expansion happens inside the container's bash, where ARG_MAX is ~2MB.
    const model = this.agentConfig.model ?? DEFAULT_MODEL;
    const args = [
      'bash', '-c',
      `opencode run "$(cat ${promptFilePath})" --format json --model ${model}`,
    ];

    return { args, promptDelivery: 'file' };
  }

  getMockDockerArgs(stepId: string, isGitMode: boolean): string[] {
    const copyOutputCmd =
      `cp -r /mock-data/* /output/ 2>/dev/null; ` +
      `if [ -f "/mock-fixtures/${stepId}.json" ]; then ` +
        `cp /mock-fixtures/${stepId}.json /output/mock-result.json && ` +
        `echo "[mock-opencode] step=${stepId}: copied data + fixture" >&2; ` +
      `else ` +
        `echo '{"mock":true,"summary":"Mock OpenCode output for step ${stepId}"}' > /output/mock-result.json && ` +
        `echo "[mock-opencode] step=${stepId}: no fixture, generic mock" >&2; ` +
      `fi`;

    const mockAgentResponse = JSON.stringify({
      output_file: '/output/mock-result.json',
      summary: `Mock OpenCode output for step ${stepId}`,
    });
    // Wrap in OpenCode's JSONL format: { "type": "text", "part": { "text": "..." } }
    const mockOpenCodeJson = JSON.stringify({ type: 'text', part: { type: 'text', text: mockAgentResponse } });

    if (isGitMode) {
      const copyWorkspaceCmd =
        `WSDIR=$(grep -o '"_workspaceDir"[[:space:]]*:[[:space:]]*"[^"]*"' /mock-fixtures/${stepId}.json 2>/dev/null | sed 's/.*"\\([^"]*\\)"$/\\1/'); ` +
        `if [ -n "$WSDIR" ] && [ -d "/mock-data/$WSDIR" ]; then ` +
          `cp -r /mock-data/$WSDIR/* /workspace/ && ` +
          `echo "[mock-opencode] step=${stepId}: copied $WSDIR/ into /workspace/ for git commit" >&2; ` +
        `else ` +
          `echo "# Mock output from step ${stepId}" > /workspace/mock-${stepId}-output.md; ` +
        `fi`;

      return [
        'bash', '-c',
        `${copyOutputCmd} && ${copyWorkspaceCmd} && ` +
        `echo '${mockOpenCodeJson.replace(/'/g, "'\\''")}'`,
      ];
    }

    return [
      'bash', '-c',
      `${copyOutputCmd} && ` +
      `echo '${mockOpenCodeJson.replace(/'/g, "'\\''")}'`,
    ];
  }

  protected override processOutputLine(line: string): string[] {
    // Map OpenCode JSONL events to the log format the AgentLogViewer UI expects.
    // OpenCode events:
    //   {"type":"text","part":{"text":"..."}}
    //   {"type":"tool_use","part":{"tool":"bash","state":{"status":"done|error","input":{...},"output":"...","error":"..."}}}
    //   {"type":"step_start",...}
    //   {"type":"step_finish","part":{"cost":...,"tokens":{...}}}
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return [];

    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        timestamp?: number;
        part?: {
          type?: string;
          text?: string;
          tool?: string;
          callID?: string;
          state?: {
            status?: string;
            input?: Record<string, unknown>;
            output?: string;
            error?: string;
          };
          cost?: number;
          tokens?: Record<string, unknown>;
          reason?: string;
        };
      };

      const ts = event.timestamp
        ? new Date(event.timestamp).toISOString()
        : new Date().toISOString();

      if (event.type === 'text' && event.part?.text) {
        return [JSON.stringify({ ts, type: 'assistant', subtype: 'text', text: event.part.text })];
      }

      if (event.type === 'tool_use' && event.part?.tool) {
        const entries: string[] = [];
        const toolName = event.part.tool;
        const state = event.part.state;

        // Emit tool_call entry
        entries.push(JSON.stringify({
          ts,
          type: 'assistant',
          subtype: 'tool_call',
          tool: toolName,
          input: state?.input,
        }));

        // If the state already has output/error, emit a tool_result too
        if (state?.output || state?.error) {
          entries.push(JSON.stringify({
            ts,
            type: 'tool_result',
            tool_name: toolName,
            content: state.error
              ? `[error] ${state.error}`
              : (state.output ?? '').slice(0, 500),
          }));
        }

        return entries;
      }

      if (event.type === 'step_finish' && event.part) {
        const cost = event.part.cost;
        const tokens = event.part.tokens;
        const reason = event.part.reason;
        return [JSON.stringify({
          ts,
          type: 'result',
          subtype: reason ?? 'completed',
          cost,
          tokens,
        })];
      }

      // Skip step_start and other non-interesting events
      return [];
    } catch {
      return [];
    }
  }

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

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;

      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          part?: { type?: string; text?: string };
          error?: { name?: string; data?: { message?: string } };
        };

        if (event.type === 'text' && typeof event.part?.text === 'string') {
          textParts.push(event.part.text);
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

    // Find the contract JSON in text parts (scan from last to first).
    // The contract is: {"output_file": "...", "summary": "..."}
    // The model may wrap it in narration text, so extract just the JSON object.
    for (let index = textParts.length - 1; index >= 0; index--) {
      const part = textParts[index].trim();
      if (part.includes('"output_file"') || part.includes('"summary"')) {
        // Extract the JSON object from the text (model may add preamble/postamble)
        const jsonMatch = part.match(/\{[^{}]*"output_file"[^{}]*\}/);
        const contractJson = jsonMatch ? jsonMatch[0] : part;
        return JSON.stringify({ result: contractJson });
      }
    }

    // Fallback: use the last text part (most likely the final response)
    if (textParts.length > 0) {
      return JSON.stringify({ result: textParts[textParts.length - 1] });
    }

    // Only errors
    return JSON.stringify({ result: errors.map((e) => `[OpenCode error] ${e}`).join('\n') });
  }

  protected override async prepareOutputDir(outputDir: string): Promise<void> {
    // Write OpenCode config with provider configuration.
    const config: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      permission: 'allow',
    };

    const configPath = join(outputDir, 'opencode.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Write auth.json from resolved env vars.
    // OpenCode stores credentials at $XDG_DATA_HOME/opencode/auth.json.
    // The step config's env should provide DEEPSEEK_API_KEY / OPENROUTER_API_KEY.
    const auth: Record<string, { type: string; key: string }> = {};
    const env = this.resolvedEnv.vars;

    if (env.DEEPSEEK_API_KEY) {
      auth.deepseek = { type: 'api', key: env.DEEPSEEK_API_KEY };
    }

    if (env.OPENROUTER_API_KEY) {
      auth.openrouter = { type: 'api', key: env.OPENROUTER_API_KEY };
    }

    if (Object.keys(auth).length > 0) {
      const authDir = join(outputDir, '.local', 'share', 'opencode');
      await mkdir(authDir, { recursive: true });
      const authPath = join(authDir, 'auth.json');
      await writeFile(authPath, JSON.stringify(auth), 'utf-8');
    }
  }
}
