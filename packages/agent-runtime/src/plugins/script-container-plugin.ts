import { readFile, mkdtemp, writeFile, rm, realpath, mkdir, appendFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/agent-plugin';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata, Presentation } from '@mediforce/platform-core';
import { getDockerSpawnStrategy } from './docker-spawn-strategy';
import { ContainerPlugin, isWorkflowAgentContext, resolveImageBuild, formatExitInfo, type ContainerPluginInit } from './container-plugin';
import { isLocalExecutionAllowed } from './base-container-agent-plugin';

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Runtime → Docker image, file extension, and run command (as array for spawn). */
const RUNTIME_CONFIG: Record<string, { image: string; ext: string; cmd: (path: string) => string[] }> = {
  javascript: { image: 'mediforce-node:latest', ext: '.mjs', cmd: (p) => ['node', p] },
  python: { image: 'python:3.12-slim', ext: '.py', cmd: (p) => ['python', p] },
  r: { image: 'rocker/r-ver:4', ext: '.R', cmd: (p) => ['Rscript', p] },
  bash: { image: 'alpine:3.19', ext: '.sh', cmd: (p) => ['sh', p] },
};

/**
 * Best-effort extraction of a human-readable failure reason from a step's
 * /output/result.json. Script steps write their error there (`{ error }` or
 * `{ errors: [...] }`) and exit non-zero without printing to stderr, so it is
 * frequently the only actionable signal on failure. Returns null when the file
 * is absent, unparseable, or carries no error field.
 */
async function readResultError(outputDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(outputDir, 'result.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return `result.json error: ${parsed.error}`;
    }
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      return `result.json errors: ${parsed.errors.join('; ')}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Script container plugin — runs a deterministic command inside a Docker container.
 *
 * Unlike BaseContainerAgentPlugin, this does NOT involve an LLM, prompt assembly,
 * skill files, or any AI agent. Two modes:
 *
 * **Command mode** (existing): agentConfig.command + agentConfig.image
 *   1. Writes step input as /output/input.json
 *   2. Runs `docker run --rm IMAGE COMMAND`
 *   3. Reads /output/result.json from the container
 *
 * **Inline script mode** (new): agentConfig.inlineScript + agentConfig.runtime
 *   1. Writes step input as /output/input.json
 *   2. Writes inlineScript to /output/script.{ext}
 *   3. Runs the script using the runtime's command in an auto-resolved Docker image
 *   4. Reads /output/result.json from the container
 */
export class ScriptContainerPlugin extends ContainerPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Script Container',
    description: 'Runs a deterministic script or inline code inside a Docker container — no LLM involved.',
    inputDescription: 'Step input JSON at /output/input.json; carry-over from WD inputForNextRun (when declared) at /output/previous_run.json.',
    outputDescription: 'Container writes result to /output/result.json; parsed and emitted as the step result.',
    roles: ['executor'],
  };

  private image!: string;
  private commandArgs!: string[];
  private commandDisplay!: string;
  private inlineScript: string | null = null;
  private runtime: string | null = null;
  private isLocalMode = false;

  constructor(init: ContainerPluginInit = {}) {
    super(init);
  }

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;

    let agentConfig: AgentConfig | undefined;
    let stepEnv: Record<string, string> | undefined;
    let definitionEnv: Record<string, string> | undefined;

    if (isWorkflowAgentContext(context)) {
      agentConfig = context.step.agent as AgentConfig | undefined;
      stepEnv = context.step.env;
      definitionEnv = context.workflowDefinition.env;
    } else {
      const stepConfig = context.config.stepConfigs.find(
        (sc: StepConfig) => sc.stepId === context.stepId,
      );
      if (!stepConfig) {
        throw new Error(`Step config not found for stepId '${context.stepId}'`);
      }
      agentConfig = stepConfig.agentConfig;
      stepEnv = stepConfig.env;
      definitionEnv = context.config.env;
    }

    if (!agentConfig) {
      throw new Error(
        `No agent config found for step '${context.stepId}'. ` +
        `ScriptContainerPlugin requires agent config with command or inlineScript.`,
      );
    }

    if (agentConfig.inlineScript) {
      // Inline script mode — resolve runtime, image, and command automatically
      const runtime = agentConfig.runtime;
      if (!runtime) {
        throw new Error(
          `agent.runtime is required when using inlineScript for step '${context.stepId}'. ` +
          `Supported runtimes: ${Object.keys(RUNTIME_CONFIG).join(', ')}`,
        );
      }

      const runtimeCfg = RUNTIME_CONFIG[runtime];
      if (!runtimeCfg) {
        throw new Error(
          `Unknown runtime '${runtime}' for step '${context.stepId}'. ` +
          `Supported: ${Object.keys(RUNTIME_CONFIG).join(', ')}`,
        );
      }

      this.inlineScript = agentConfig.inlineScript;
      this.runtime = runtime;

      if (!agentConfig.image && isLocalExecutionAllowed()) {
        // Local mode: run the script as a child process on the host. Gated by
        // ALLOW_LOCAL_AGENTS=true. No container isolation — dev only. Mirrors
        // the same gate used in BaseContainerAgentPlugin for AI agents.
        this.isLocalMode = true;
        this.image = 'local';
        this.commandArgs = [];
        this.commandDisplay = `${runtimeCfg.cmd('script' + runtimeCfg.ext).join(' ')} (local)`;
      } else {
        this.image = agentConfig.image ?? runtimeCfg.image;
        const scriptPath = `/output/script${runtimeCfg.ext}`;
        this.commandArgs = runtimeCfg.cmd(scriptPath);
        this.commandDisplay = this.commandArgs.join(' ');
      }
    } else if (agentConfig.command) {
      // Command mode — existing behavior
      if (!agentConfig.image) {
        throw new Error(
          `No Docker image configured in agent config for step '${context.stepId}'. ` +
          'ScriptContainerPlugin requires agent.image when using command mode.',
        );
      }
      this.image = agentConfig.image;
      this.commandArgs = agentConfig.command.split(' ');
      this.commandDisplay = agentConfig.command;
    } else {
      throw new Error(
        `No command or inlineScript configured for step '${context.stepId}'. ` +
        'ScriptContainerPlugin requires either agent.command or agent.inlineScript.',
      );
    }

    // Resolve env vars from definition-level + step-level env + workflow secrets
    const workflowSecrets = isWorkflowAgentContext(context) ? context.workflowSecrets : undefined;
    this.resolveEnvironment(definitionEnv, stepEnv, workflowSecrets);
    this.imageBuild = resolveImageBuild(this.image, agentConfig, context, this.resolvedEnv.vars);
  }

  async run(emit: EmitFn): Promise<void> {
    const startTime = Date.now();

    await emit({
      type: 'status',
      payload: `starting script container: image='${this.image}', command='${this.commandDisplay}'`,
      timestamp: new Date().toISOString(),
    });

    let outputDir: string | null = null;

    try {
      // Every run gets a shared git worktree; mounted into the container at /workspace.
      await this.resolveRunWorkspace();

      // Create temp directory for container /output mount
      const rawOutputDir = await mkdtemp(join(tmpdir(), 'mediforce-script-output-'));
      outputDir = await realpath(rawOutputDir);

      // Write step input as /output/input.json
      const inputPath = join(outputDir, 'input.json');
      await writeFile(inputPath, JSON.stringify(this.context.stepInput, null, 2), 'utf-8');

      // Write carry-over snapshot as /output/previous_run.json when the
      // workflow declares inputForNextRun. Always an object — `{}` on first
      // run. Scripts that don't carry anything simply ignore the file.
      if (isWorkflowAgentContext(this.context) && this.context.previousRun !== undefined) {
        const previousRunPath = join(outputDir, 'previous_run.json');
        await writeFile(
          previousRunPath,
          JSON.stringify(this.context.previousRun, null, 2),
          'utf-8',
        );
      }

      // Write inline script to /output/script.{ext}
      if (this.inlineScript && this.runtime) {
        const runtimeCfg = RUNTIME_CONFIG[this.runtime];
        const scriptPath = join(outputDir, `script${runtimeCfg.ext}`);
        await writeFile(scriptPath, this.inlineScript, 'utf-8');
      }

      const timeoutMinutes = isWorkflowAgentContext(this.context)
        ? (this.context.step.agent as AgentConfig | undefined)?.timeoutMinutes
        : this.context.config.stepConfigs.find(
            (sc: StepConfig) => sc.stepId === this.context.stepId,
          )?.agentConfig?.timeoutMinutes;
      const timeoutMs = typeof timeoutMinutes === 'number' && timeoutMinutes > 0
        ? timeoutMinutes * 60_000
        : DEFAULT_TIMEOUT_MS;

      const logsDir = join(tmpdir(), 'mediforce-step-logs');
      await mkdir(logsDir, { recursive: true });
      const logTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = join(logsDir, `${this.context.processInstanceId}_${this.context.stepId}_${logTimestamp}.log`);

      await emit({
        type: 'status',
        payload: `agent activity log: ${logFile}`,
        timestamp: new Date().toISOString(),
      });

      const emitLine = (text: string): void => {
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          type: 'assistant',
          subtype: 'text',
          text,
        });
        appendFile(logFile, entry + '\n').catch(() => {});
        emit({
          type: 'assistant',
          payload: entry,
          timestamp: new Date().toISOString(),
        }).catch((err) => {
          console.warn('[ScriptContainer] activity emit failed:', err);
        });
      };

      let spawnResult: { stdout: string; stderr: string; exitCode: number | null; signal: string | null };

      if (this.isLocalMode && this.inlineScript && this.runtime) {
        // Local execution: run the inline script as a child process. The
        // /output mount is replaced by the host outputDir, so we rewrite any
        // hard-coded `/output/` references in the script source to point at
        // the temp dir. No Docker, no /workspace mount.
        const runtimeCfg = RUNTIME_CONFIG[this.runtime];
        const rewrittenScript = this.inlineScript.replaceAll('/output/', `${outputDir}/`);
        const localScriptPath = join(outputDir, `script${runtimeCfg.ext}`);
        await writeFile(localScriptPath, rewrittenScript, 'utf-8');

        const cmdArgs = runtimeCfg.cmd(localScriptPath);
        console.log(`[ScriptContainer] Spawning LOCAL: ${cmdArgs.join(' ')}`);

        await emit({
          type: 'status',
          payload: 'running locally (no Docker) — ALLOW_LOCAL_AGENTS=true',
          timestamp: new Date().toISOString(),
        });

        spawnResult = await this.spawnLocalScript(cmdArgs, outputDir, timeoutMs, emitLine);
      } else {
        const containerName = `mediforce-script-${this.context.processInstanceId}-${this.context.stepId}`.slice(0, 63);

        const envFlags: string[] = [];
        envFlags.push('-e', `RUN_ID=${this.context.processInstanceId}`);
        envFlags.push('-e', `STEP_ID=${this.context.stepId}`);
        if (isWorkflowAgentContext(this.context) && this.context.runNamespace) {
          envFlags.push('-e', `MEDIFORCE_RUN_NAMESPACE=${this.context.runNamespace}`);
        }
        for (const [key, value] of Object.entries(this.resolvedEnv.vars)) {
          envFlags.push('-e', `${key}=${value}`);
        }

        const dockerArgs: string[] = [
          'run', '--rm',
          '--name', containerName,
          '--memory', '8g',
          '--cpus', '2',
          '-v', `${outputDir}:/output`,
          '-v', `${this.runWorkspaceHandle!.path}:/workspace`,
          '-w', '/workspace',
          ...envFlags,
          this.image,
          ...this.commandArgs,
        ];

        console.log(`[ScriptContainer] Spawning: docker ${dockerArgs.join(' ')}`);

        // Delegate container execution to the spawn strategy. Each stdout/stderr line
        // is forwarded to the activity feed as it arrives (local strategy) or replayed
        // line-for-line after exit (queued strategy) — payloads are byte-identical, only
        // the timing differs. We don't await `emit` inside the callback (would block
        // stream consumption); FirestoreAgentEventLog serializes per-step writes so
        // sequence numbers stay monotonic, and the final `await emit({type:'result'})`
        // below waits for all in-flight live emits to land before resolving.
        const strategy = getDockerSpawnStrategy();

        spawnResult = await strategy.spawn({
          dockerArgs,
          stdinPayload: null,
          timeoutMs,
          containerName,
          processInstanceId: this.context.processInstanceId,
          stepId: this.context.stepId,
          outputDir,
          logFile,
          imageBuild: this.imageBuild,
          onStdoutLine: emitLine,
          onStderrLine: (line) => emitLine(`[stderr] ${line}`),
        });
      }

      await emit({
        type: 'status',
        payload: `container exited: code=${spawnResult.exitCode}, signal=${spawnResult.signal ?? 'none'}`,
        timestamp: new Date().toISOString(),
      });

      if (spawnResult.exitCode !== 0) {
        const exitInfo = formatExitInfo(spawnResult, Math.round(timeoutMs / 60_000));
        const stderr = spawnResult.stderr.trim();
        const stdout = spawnResult.stdout.trim();

        let detail: string;
        if (stderr.length > 0 || stdout.length > 0) {
          // Captured streams were already written to the activity log line by
          // line during the run, so they already show in the Step Log panel.
          detail = stderr.length > 0 ? stderr : stdout;
        } else {
          // No stdout/stderr — but script-container steps write their structured
          // output (incl. an `error`/`errors` field on failure) to result.json
          // by convention, then exit non-zero without printing. Surface that
          // reported error before falling back to bare invocation metadata.
          const reportedError = await readResultError(outputDir);
          if (reportedError !== null) {
            detail = reportedError;
          } else {
            // RUN_ID / STEP_ID (and MEDIFORCE_RUN_NAMESPACE for workflow runs)
            // are injected into every container separately from resolvedEnv.vars,
            // so list them too — they're part of what the script saw.
            const injectedKeys = ['RUN_ID', 'STEP_ID'];
            if (isWorkflowAgentContext(this.context) && this.context.runNamespace) {
              injectedKeys.push('MEDIFORCE_RUN_NAMESPACE');
            }
            const envKeys = [...Object.keys(this.resolvedEnv.vars), ...injectedKeys].join(',');
            let inputSize = '?';
            try {
              const inputStat = await stat(join(outputDir, 'input.json'));
              inputSize = `${inputStat.size}b`;
            } catch { /* missing — shouldn't happen */ }
            detail = `no stdout/stderr/result captured — image=${this.image}, cmd=${this.commandDisplay}, env=[${envKeys}], inputSize=${inputSize}`;
          }
          // The Step Log panel renders the activity log FILE, not the event
          // stream, and this failure streamed nothing into it. Write the reason
          // there so the panel shows it instead of sticking on "Initializing
          // log…".
          emitLine(detail);
        }

        await emit({
          type: 'status',
          payload: `script failed (${exitInfo}): ${detail.slice(0, 2000)}`,
          timestamp: new Date().toISOString(),
        });

        throw new Error(`Script container failed (${exitInfo}): ${detail}`);
      }

      const containerOutput = spawnResult.stdout.trim();

      // Commit whatever the script wrote into /workspace (empty = --allow-empty).
      // No reasoningSummary — the file delta is the more useful subject line
      // for deterministic scripts; the command is available via Agent-Image
      // + script.sh artefact for anyone digging deeper.
      await this.commitRunWorkspace(outputDir, {
        status: 'success',
        durationMs: Date.now() - startTime,
        agentPlugin: 'script-container',
        agentImage: this.image,
      });

      // Read result.json from the output directory
      const resultPath = join(outputDir, 'result.json');
      let result: Record<string, unknown>;
      try {
        const resultRaw = await readFile(resultPath, 'utf-8');
        result = JSON.parse(resultRaw) as Record<string, unknown>;
      } catch {
        // If no result.json, use stdout as raw output
        result = { raw: containerOutput };
      }

      // Read presentation.md or presentation.html if the script wrote one.
      // Markdown wins on tie — safer surface, cheaper to author. HTML stays
      // available for cases that genuinely need JS / iframe interactivity.
      let presentation: Presentation | null = null;
      try {
        presentation = {
          kind: 'markdown',
          content: await readFile(join(outputDir, 'presentation.md'), 'utf-8'),
        };
      } catch {
        try {
          presentation = {
            kind: 'html',
            content: await readFile(join(outputDir, 'presentation.html'), 'utf-8'),
          };
        } catch {
          // No presentation file — fine
        }
      }

      const durationMs = Date.now() - startTime;

      await emit({
        type: 'result',
        payload: {
          confidence: 1.0,
          reasoning_summary: `Script container completed: ${this.commandDisplay}`,
          reasoning_chain: [
            `Image: ${this.image}`,
            `Command: ${this.commandDisplay}`,
            `Duration: ${durationMs}ms`,
          ],
          annotations: [],
          model: 'script',
          duration_ms: durationMs,
          result,
          ...(presentation ? { presentation } : {}),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Commit whatever landed in /workspace before the error — ✗ marker,
      // full error excerpt in body. Best-effort: if the commit itself fails
      // (e.g. worktree corrupt, detected secret), swallow that error and
      // rethrow the original step error. We never mask the real failure.
      const errMessage = error instanceof Error ? error.message : String(error);
      if (outputDir) {
        try {
          await this.commitRunWorkspace(outputDir, {
            status: 'failed',
            error: errMessage,
            durationMs: Date.now() - startTime,
            agentPlugin: 'script-container',
            agentImage: this.image,
          });
        } catch (commitErr) {
          console.warn('[ScriptContainer] Failed to commit failure artefacts:', commitErr);
        }
        await rm(outputDir, { recursive: true, force: true }).catch(() => {});
        outputDir = null;
      }
      // Script steps are deterministic — errors must fail the step, not produce a low-confidence result
      throw error;
    } finally {
      if (outputDir) {
        await rm(outputDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Spawn the script as a host child process (local mode). Live-streams
   * stdout/stderr via emitLine for parity with the docker spawn path.
   * Resolves with the same shape as DockerSpawnStrategy so the caller
   * doesn't branch.
   */
  private spawnLocalScript(
    cmdArgs: string[],
    cwd: string,
    timeoutMs: number,
    emitLine: (text: string) => void,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null }> {
    return new Promise((resolve) => {
      const [cmd, ...args] = cmdArgs;
      const childEnv: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        ...this.resolvedEnv.vars,
        RUN_ID: this.context.processInstanceId,
        STEP_ID: this.context.stepId,
        ...(isWorkflowAgentContext(this.context) && this.context.runNamespace
          ? { MEDIFORCE_RUN_NAMESPACE: this.context.runNamespace }
          : {}),
      };
      const child = spawn(cmd, args, {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let stdoutBuf = '';
      let stderrBuf = '';
      let settled = false;

      const flushLines = (buf: string, prefix: string): string => {
        const lines = buf.split('\n');
        const trailing = lines.pop() ?? '';
        for (const line of lines) {
          if (line.length > 0) emitLine(prefix ? `${prefix}${line}` : line);
        }
        return trailing;
      };

      const flushBuffers = (): void => {
        if (stdoutBuf.length > 0) {
          emitLine(stdoutBuf);
          stdoutBuf = '';
        }
        if (stderrBuf.length > 0) {
          emitLine(`[stderr] ${stderrBuf}`);
          stderrBuf = '';
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        stdoutBuf = flushLines(stdoutBuf + text, '');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuf = flushLines(stderrBuf + text, '[stderr] ');
      });

      let killTimer: NodeJS.Timeout | null = null;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          killTimer = null;
          if (!settled) child.kill('SIGKILL');
        }, 5_000);
      }, timeoutMs);

      const clearTimers = (): void => {
        clearTimeout(timer);
        if (killTimer !== null) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };

      // Spawn errors (e.g. ENOENT when the runtime binary isn't installed)
      // fire 'error' but never 'close'. Without this listener the Promise
      // would hang until the step-level timeout. Resolve with a synthetic
      // failure so the caller throws "Script container failed (...)" with
      // the underlying message.
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimers();
        flushBuffers();
        const msg = err instanceof Error ? err.message : String(err);
        emitLine(`[stderr] spawn failed: ${msg}`);
        resolve({
          stdout,
          stderr: stderr ? `${stderr}\n${msg}` : msg,
          exitCode: null,
          signal: null,
        });
      });

      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimers();
        flushBuffers();
        resolve({ stdout, stderr, exitCode, signal: signal ?? null });
      });
    });
  }
}
