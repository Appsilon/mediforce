import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentPlugin, AgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';

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

  const tempDir = await mkdtemp(join(tmpdir(), 'mediforce-agent-'));
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
  kind: 'tool_call' | 'assistant' | 'result';
  tool?: string;
  input?: Record<string, unknown>;
  text?: string;
  subtype?: string;
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
          kind: 'tool_call',
          tool: block.name,
          input: block.input as Record<string, unknown> | undefined,
        });
      }
      if (block.type === 'text' && block.text) {
        entries.push({ ts, kind: 'assistant', text: block.text });
      }
    }
  }

  if (event.type === 'result') {
    entries.push({
      ts,
      kind: 'result',
      subtype: event.subtype,
      text: typeof event.result === 'string' ? event.result.slice(0, 500) : undefined,
    });
  }

  return entries.map((entry) => JSON.stringify(entry));
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

    await emit({
      type: 'status',
      payload: `spawning Claude Code CLI with skill '${skillName}'`,
      timestamp: new Date().toISOString(),
    });

    let tempDir: string | null = null;

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

      const prompt = await this.buildPrompt(updatedInput);
      const options: SpawnCliOptions = {};
      if (this.agentConfig.model) options.model = this.agentConfig.model;
      if (tempDir) options.addDirs = [tempDir];

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

      let parsedResult: Record<string, unknown>;
      try {
        parsedResult = JSON.parse(cliOutput) as Record<string, unknown>;
      } catch {
        parsedResult = { raw: cliOutput };
      }

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
        },
        timestamp: new Date().toISOString(),
      });
    } finally {
      await cleanupTempDir(tempDir);
    }
  }

  private async buildPrompt(stepInput?: Record<string, unknown>): Promise<string> {
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

    // 3. Input context
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

    const logFile = options?.logFile ?? null;

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10 * 60_000,
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

        if (code !== 0) {
          const exitInfo = signal
            ? `killed by ${signal}${signal === 'SIGTERM' ? ' (likely timeout — 10 min limit)' : ''}`
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
