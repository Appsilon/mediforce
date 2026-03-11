import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, mkdir, appendFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentPlugin, AgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';

const DEFAULT_TIMEOUT_MS = 20 * 60_000;

/** Strip YAML frontmatter (--- ... ---) from markdown content. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

interface FileEntry {
  name: string;
  downloadUrl: string;
  localPath?: string;
  [key: string]: unknown;
}

interface SpawnCliOptions {
  model?: string;
  addDirs?: string[];
  logFile?: string;
  timeoutMs?: number;
  outputDir?: string;
}

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

function hasFiles(input: Record<string, unknown>): input is Record<string, unknown> & { files: FileEntry[] } {
  return Array.isArray(input.files) &&
    input.files.length > 0 &&
    typeof input.files[0].downloadUrl === 'string';
}

/** Download remote files to a temp directory and return updated input with localPath fields. */
async function downloadFilesToLocal(
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
async function cleanupTempDir(tempDir: string | null): Promise<void> {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
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

interface AgentOutputContract {
  output_file?: string;
  summary?: string;
}

export class ClaudeCodeAgentPlugin implements AgentPlugin {
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
  };

  private context!: AgentContext;
  private agentConfig!: AgentConfig;

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;

    const stepConfig = context.config.stepConfigs.find(
      (sc: StepConfig) => sc.stepId === context.stepId,
    );

    if (!stepConfig) {
      throw new Error(`Step config not found for stepId '${context.stepId}'`);
    }

    const agentConfig = stepConfig.agentConfig ?? {};
    if (!agentConfig.skill && !agentConfig.prompt) {
      throw new Error(
        `Neither skill nor prompt configured in agentConfig for step '${context.stepId}'. ` +
        'ClaudeCodeAgentPlugin requires at least one of agentConfig.skill or agentConfig.prompt.',
      );
    }

    this.agentConfig = agentConfig;
  }

  async run(emit: EmitFn): Promise<void> {
    const startTime = Date.now();
    const skillName = this.agentConfig.skill ?? 'custom-prompt';
    const timeoutMs = this.agentConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    await emit({
      type: 'status',
      payload: `spawning Claude Code CLI with skill '${skillName}'`,
      timestamp: new Date().toISOString(),
    });

    let tempDir: string | null = null;
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

      const prompt = await this.buildPrompt(updatedInput, timeoutMs, tempDir ?? undefined);

      await emit({
        type: 'prompt',
        payload: prompt,
        timestamp: new Date().toISOString(),
      });

      const options: SpawnCliOptions = { timeoutMs };
      if (this.agentConfig.model) options.model = this.agentConfig.model;
      if (tempDir) {
        options.addDirs = [tempDir];
        options.outputDir = tempDir;
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

      const cliOutput = await this.spawnClaudeCli(prompt, options);
      const duration_ms = Date.now() - startTime;

      const parsedResult = await this.extractResult(cliOutput);

      const confidence = typeof parsedResult.confidence === 'number'
        ? parsedResult.confidence
        : 0.7;

      await emit({
        type: 'result',
        payload: {
          confidence,
          reasoning_summary: `Claude Code skill '${skillName}' completed successfully`,
          reasoning_chain: [
            `Invoked skill: ${skillName}`,
            `Input keys: ${Object.keys(this.context.stepInput).join(', ')}`,
            tempDir ? `Downloaded files to temp dir` : 'No file downloads needed',
            'CLI execution completed',
          ],
          annotations: [],
          model: this.agentConfig.model ?? 'claude-code-cli',
          duration_ms,
          result: parsedResult,
        },
        timestamp: new Date().toISOString(),
      });

      succeeded = true;
    } catch (error) {
      const duration_ms = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await emit({
        type: 'result',
        payload: {
          confidence: 0,
          reasoning_summary: `Claude Code skill '${skillName}' failed with error: ${errorMessage}`,
          reasoning_chain: [
            `Invoked skill: ${skillName}`,
            `Error: ${errorMessage}`,
          ],
          annotations: [],
          model: this.agentConfig.model ?? 'claude-code-cli',
          duration_ms,
          result: null,
          tempDir: tempDir ?? undefined,
        },
        timestamp: new Date().toISOString(),
      });
    } finally {
      if (succeeded) {
        await cleanupTempDir(tempDir);
      }
    }
  }

  private async extractResult(cliOutput: string): Promise<Record<string, unknown>> {
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
      return { raw: agentText };
    }

    if (contract.output_file) {
      try {
        const fileContents = await readFile(contract.output_file, 'utf-8');
        const parsed = JSON.parse(fileContents) as Record<string, unknown>;
        if (contract.summary) {
          parsed.summary = contract.summary;
        }
        return parsed;
      } catch {
        return { raw: agentText, summary: contract.summary };
      }
    }

    return contract as unknown as Record<string, unknown>;
  }

  private async buildPrompt(
    stepInput?: Record<string, unknown>,
    timeoutMs?: number,
    outputDir?: string,
  ): Promise<string> {
    const parts: string[] = [];
    const input = stepInput ?? this.context.stepInput;

    // 1. Skill prompt from SKILL.md
    if (this.agentConfig.skill && this.agentConfig.skillsDir) {
      const skillContent = await this.readSkillFile(
        this.agentConfig.skillsDir,
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

    // 4. Output directory — agent MUST use absolute paths when writing files
    if (outputDir) {
      parts.push(
        `## Output Directory\n` +
        `Write all output files to this absolute path: ${outputDir}\n` +
        `You MUST use the full absolute path when calling Write. Relative paths will be rejected.`,
      );
    }

    // 5. Input context
    const previousOutputs = await this.context.getPreviousStepOutputs();
    const hasPreviousOutputs = Object.keys(previousOutputs).length > 0;

    parts.push('## Input Data');
    parts.push(JSON.stringify(input, null, 2));

    if (hasPreviousOutputs) {
      parts.push('## Previous Step Outputs');
      parts.push(JSON.stringify(previousOutputs, null, 2));
    }

    return parts.join('\n\n');
  }

  protected async readSkillFile(skillsDir: string, skill: string): Promise<string> {
    const skillPath = join(skillsDir, skill, 'SKILL.md');
    const raw = await readFile(skillPath, 'utf-8');
    return stripFrontmatter(raw);
  }

  protected async spawnClaudeCli(prompt: string, options?: SpawnCliOptions): Promise<string> {
    // Use stream-json to capture agent activity for observability.
    // The final "result" event contains the same output as --output-format json.
    const args = ['-p', '--verbose', '--output-format', 'stream-json'];

    if (options?.model) {
      args.push('--model', options.model);
    }
    if (options?.addDirs) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir);
      }
    }
    // Headless pipeline: grant specific tool permissions so the agent never blocks on prompts.
    // The agent is sandboxed: cwd set to temp dir, output read back by plugin.
    // Note: path-scoped patterns (e.g. Write(/path/*)) don't work reliably in the CLI,
    // so we grant tool-level access. The cwd and prompt constrain where the agent writes.
    // Future: use --permission-prompt-tool for human-in-the-loop approval via platform UI.
    args.push('--allowedTools', 'Read,Write,Edit,Glob,Grep');

    const logFile = options?.logFile ?? null;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        // Set cwd to outputDir so relative paths resolve to the temp dir.
        // This ensures Write("file.json") matches the --allowedTools pattern.
        ...(options?.outputDir ? { cwd: options.outputDir } : {}),
      });

      let finalResult = '';
      let buffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');

        // Process complete lines (newline-delimited JSON)
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed) as StreamEvent;

            // Capture the final result
            if (event.type === 'result') {
              finalResult = trimmed;
            }

            // Write human-readable activity to log file
            if (logFile) {
              const logLines = formatLogEntries(event);
              if (logLines.length > 0) {
                appendFile(logFile, logLines.join('\n') + '\n').catch(() => {});
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('error', (error) => {
        reject(new Error(`CLI process failed: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim()) as StreamEvent;
            if (event.type === 'result') {
              finalResult = buffer.trim();
            }
            if (logFile) {
              const logLines = formatLogEntries(event);
              if (logLines.length > 0) {
                appendFile(logFile, logLines.join('\n') + '\n').catch(() => {});
              }
            }
          } catch {
            // ignore
          }
        }

        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        const timeoutMinutes = Math.round(timeoutMs / 60_000);

        if (code !== 0) {
          const exitInfo = signal
            ? `killed by ${signal}${signal === 'SIGTERM' ? ` (likely timeout — ${timeoutMinutes} min limit)` : ''}`
            : `exit code ${code}`;
          reject(new Error(`CLI process failed (${exitInfo}): ${stderr || 'no stderr output'}`));
          return;
        }

        if (!finalResult) {
          reject(new Error('CLI produced no result event'));
          return;
        }

        resolve(finalResult);
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}
