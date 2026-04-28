import type { PluginCapabilityMetadata } from '@mediforce/platform-core';
import {
  BaseContainerAgentPlugin,
  type SpawnCliOptions,
  type AgentCommandSpec,
} from './base-container-agent-plugin.js';
import { isWorkflowAgentContext } from './container-plugin.js';

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
  };
  result?: string;
  tool_name?: string;
  tool_input?: unknown;
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  type: string;
  subtype?: string;
  tool?: string;
  input?: Record<string, unknown>;
  text?: string;
  [key: string]: unknown;
}

/** Extract log entries from a stream-json event. Returns JSONL strings. */
function formatLogEntries(event: StreamEvent): string[] {
  const ts = new Date().toISOString();
  const entries: LogEntry[] = [];

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use' && block.name) {
        entries.push({
          ts,
          type: 'assistant',
          subtype: 'tool_call',
          tool: block.name,
          input: block.input as Record<string, unknown> | undefined,
        });
      }
      if (block.type === 'text' && block.text) {
        entries.push({ ts, type: 'assistant', subtype: 'text', text: block.text });
      }
    }
    return entries.map((entry) => JSON.stringify(entry));
  }

  if (event.type === 'tool_result') {
    entries.push({
      ts,
      type: 'tool_result',
      tool_name: event.tool_name as string | undefined,
      subtype: event.subtype,
      content: event.content,
    });
    return entries.map((entry) => JSON.stringify(entry));
  }

  // CLI stream-json sends tool results as `user` messages with tool_result content blocks
  if (event.type === 'user' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_result') {
        const resultContent = (block as Record<string, unknown>).content;
        const preview = typeof resultContent === 'string'
          ? resultContent.slice(0, 500)
          : JSON.stringify(resultContent ?? '').slice(0, 500);
        entries.push({
          ts,
          type: 'user',
          subtype: 'tool_result',
          tool_use_id: (block as Record<string, unknown>).tool_use_id as string | undefined,
          content: preview,
        });
      }
    }
    if (entries.length > 0) {
      return entries.map((entry) => JSON.stringify(entry));
    }
  }

  if (event.type === 'result') {
    entries.push({
      ts,
      type: 'result',
      subtype: event.subtype,
      text: typeof event.result === 'string' ? event.result.slice(0, 500) : undefined,
    });
    return entries.map((entry) => JSON.stringify(entry));
  }

  // Generic fallback: capture any event type we don't explicitly handle
  const { type, subtype, ...rest } = event;
  entries.push({
    ts,
    type,
    subtype,
    ...rest,
  });
  return entries.map((entry) => JSON.stringify(entry));
}

/** Extract a human-readable error from a stream-json result line (if any). */
function extractErrorDetail(resultLine: string): string | null {
  if (!resultLine) return null;
  try {
    const event = JSON.parse(resultLine) as StreamEvent;
    if (event.type === 'result' && typeof event.result === 'string') {
      return event.result.slice(0, 500);
    }
  } catch {
    // not valid JSON
  }
  return null;
}

export class ClaudeCodeAgentPlugin extends BaseContainerAgentPlugin {
  readonly agentName = 'Claude Code';

  readonly metadata: PluginCapabilityMetadata = {
    name: 'Claude Code Agent',
    description:
      'General-purpose AI agent powered by Claude Code CLI. ' +
      'Executes configurable skills — from document extraction to code generation — ' +
      'driven by SKILL.md prompts and structured input data.',
    inputDescription:
      'Any structured JSON context: file paths, previous step outputs, domain data. ' +
      'Adapts to the configured skill.',
    outputDescription:
      'Skill-dependent structured JSON with confidence scoring. ' +
      'Examples: extracted metadata, generated code, analysis reports.',
    roles: ['executor'],
    foundationModel: 'Claude Sonnet 4.6',
  };

  getAgentCommand(_promptFilePath: string, options?: SpawnCliOptions): AgentCommandSpec {
    const args: string[] = [
      'claude', '-p', '--verbose', '--output-format', 'stream-json',
    ];

    if (options?.model) {
      args.push('--model', options.model);
    }
    if (options?.addDirs) {
      // In Docker mode, files are mounted at /data; in local mode, use the real host path
      for (const dir of options.addDirs) {
        args.push('--add-dir', this.agentConfig.image ? '/data' : dir);
      }
    }
    if (options?.pluginDir) {
      // options.pluginDir is whatever the agent will actually see —
      // the base plugin rewrites it to the container path in Docker mode.
      args.push('--plugin-dir', options.pluginDir);
    }
    // Headless pipeline: grant specific tool permissions so the agent never blocks on prompts.
    const allowedTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
      ...(this.agentConfig.allowedTools ?? []),
    ];

    // MCP server configuration — generated by prepareOutputDir(). Servers
    // may come from two sources, in priority order:
    //
    //   1. Workflow mode (Step 5) — context.resolvedMcpConfig produced by
    //      resolveEffectiveMcp(agent, step, catalog). This is the canonical
    //      path for workflow runs; bindings live on AgentDefinition, not on
    //      the step.
    //   2. Legacy process-mode — agentConfig.mcpServers (array inlined on
    //      the step). Still used by non-migrated process-mode steps.
    //
    // Previously this branch only checked (2), silently dropping --mcp-config
    // for every workflow-mode step and leaving the CLI to read the operator's
    // personal ~/.claude config instead of the platform-resolved one.
    const workflowResolved = isWorkflowAgentContext(this.context)
      ? this.context.resolvedMcpConfig
      : undefined;
    const mcpServerEntries: Array<{ name: string; allowedTools?: string[] }> =
      workflowResolved !== undefined
        ? Object.entries(workflowResolved.servers).map(([name, server]) => ({
            name,
            allowedTools: server.allowedTools,
          }))
        : (this.agentConfig.mcpServers ?? []).map((s) => ({
            name: s.name,
            allowedTools: s.allowedTools,
          }));

    if (mcpServerEntries.length > 0) {
      if (!this.agentConfig.image && !options?.outputDir) {
        throw new Error('MCP config requires outputDir in local mode');
      }
      const mcpConfigPath = this.agentConfig.image
        ? '/output/mcp-config.json'
        : `${options!.outputDir}/mcp-config.json`;
      args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');

      for (const server of mcpServerEntries) {
        if (server.allowedTools && server.allowedTools.length > 0) {
          for (const tool of server.allowedTools) {
            allowedTools.push(`mcp__${server.name}__${tool}`);
          }
        } else {
          allowedTools.push(`mcp__${server.name}__*`);
        }
      }
    }

    args.push('--allowedTools', allowedTools.join(','));

    return { args, promptDelivery: 'stdin' };
  }

  getMockDockerArgs(stepId: string): string[] {
    // /mock-data/    — ro mount of real output files
    // /mock-fixtures — ro mount of per-step result JSONs
    // Every mock run: copy data to /output, copy fixture as /output/mock-result.json,
    // optionally copy workspace files (from fixture's _workspaceDir) into /workspace/
    // so the host commits them on step completion.
    const copyOutputCmd =
      `cp -r /mock-data/* /output/ 2>/dev/null; ` +
      `if [ -f "/mock-fixtures/${stepId}.json" ]; then ` +
        `cp /mock-fixtures/${stepId}.json /output/mock-result.json && ` +
        `echo "[mock-agent] step=${stepId}: copied data + fixture" >&2; ` +
      `else ` +
        `echo '{"mock":true,"summary":"Mock output for step ${stepId}"}' > /output/mock-result.json && ` +
        `echo "[mock-agent] step=${stepId}: no fixture, generic mock" >&2; ` +
      `fi`;

    // If the fixture declares a `_workspaceDir`, copy it into /workspace so the host commits it.
    const copyWorkspaceCmd =
      `WSDIR=$(grep -o '"_workspaceDir"[[:space:]]*:[[:space:]]*"[^"]*"' /mock-fixtures/${stepId}.json 2>/dev/null | sed 's/.*"\\([^"]*\\)"$/\\1/'); ` +
      `if [ -n "$WSDIR" ] && [ -d "/mock-data/$WSDIR" ]; then ` +
        `cp -r /mock-data/$WSDIR/* /workspace/ && ` +
        `echo "[mock-agent] step=${stepId}: copied $WSDIR/ into /workspace/" >&2; ` +
      `fi`;

    const mockAgentResponse = JSON.stringify({
      output_file: '/output/mock-result.json',
      summary: `Mock output for step ${stepId}`,
    });
    const mockStreamJson = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: mockAgentResponse,
    });

    return [
      'bash', '-c',
      `${copyOutputCmd} && ${copyWorkspaceCmd}; ` +
      `echo '${mockStreamJson.replace(/'/g, "'\\''")}'`,
    ];
  }

  parseAgentOutput(rawStdout: string): string {
    // Claude CLI outputs NDJSON (stream-json). Scan for the last `result` event.
    let lastResult = '';
    for (const line of rawStdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as StreamEvent;
        if (event.type === 'result') {
          lastResult = trimmed;
        }
      } catch {
        // Skip non-JSON lines (Docker/entrypoint output)
      }
    }
    return lastResult;
  }

  protected override processOutputLine(line: string): string[] {
    try {
      const event = JSON.parse(line) as StreamEvent;
      return formatLogEntries(event);
    } catch {
      return [];
    }
  }

  protected override extractErrorFromResult(resultLine: string): string | null {
    return extractErrorDetail(resultLine);
  }
}
