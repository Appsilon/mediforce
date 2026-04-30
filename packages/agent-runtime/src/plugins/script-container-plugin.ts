import { readFile, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';
import { getDockerSpawnStrategy } from './docker-spawn-strategy.js';
import { ContainerPlugin, isWorkflowAgentContext, resolveImageBuild, type ContainerPluginInit } from './container-plugin.js';

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Runtime → Docker image, file extension, and run command (as array for spawn). */
const RUNTIME_CONFIG: Record<string, { image: string; ext: string; cmd: (path: string) => string[] }> = {
  javascript: { image: 'mediforce-node:latest', ext: '.mjs', cmd: (p) => ['node', p] },
  python: { image: 'python:3.12-slim', ext: '.py', cmd: (p) => ['python', p] },
  r: { image: 'rocker/r-ver:4', ext: '.R', cmd: (p) => ['Rscript', p] },
  bash: { image: 'alpine:3.19', ext: '.sh', cmd: (p) => ['sh', p] },
};

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
      this.image = agentConfig.image ?? runtimeCfg.image;
      const scriptPath = `/output/script${runtimeCfg.ext}`;
      this.commandArgs = runtimeCfg.cmd(scriptPath);
      this.commandDisplay = this.commandArgs.join(' ');
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
      const containerName = `mediforce-script-${this.context.processInstanceId}-${this.context.stepId}`.slice(0, 63);

      const envFlags: string[] = [];
      envFlags.push('-e', `RUN_ID=${this.context.processInstanceId}`);
      envFlags.push('-e', `STEP_ID=${this.context.stepId}`);
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

      // Delegate container execution to the spawn strategy.
      const strategy = getDockerSpawnStrategy();
      const spawnResult = await strategy.spawn({
        dockerArgs,
        stdinPayload: null,
        timeoutMs,
        containerName,
        processInstanceId: this.context.processInstanceId,
        stepId: this.context.stepId,
        outputDir,
        logFile: null,
        imageBuild: this.imageBuild,
      });

      // Emit stdout/stderr lines as activity events (batch mode after completion)
      for (const line of spawnResult.stdout.split('\n').filter(Boolean)) {
        await emit({
          type: 'assistant',
          payload: JSON.stringify({ ts: new Date().toISOString(), type: 'assistant', subtype: 'text', text: line }),
          timestamp: new Date().toISOString(),
        });
      }
      for (const line of spawnResult.stderr.split('\n').filter(Boolean)) {
        await emit({
          type: 'assistant',
          payload: JSON.stringify({ ts: new Date().toISOString(), type: 'assistant', subtype: 'text', text: `[stderr] ${line}` }),
          timestamp: new Date().toISOString(),
        });
      }

      if (spawnResult.exitCode !== 0) {
        const exitInfo = spawnResult.signal
          ? `killed by ${spawnResult.signal}`
          : `exit code ${spawnResult.exitCode}`;
        const detail = spawnResult.stderr.trim() || spawnResult.stdout.trim() || 'no output';
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
}
