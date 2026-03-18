import { readFile, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentPlugin, AgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';
import { resolveStepEnv, type ResolvedEnv } from './resolve-env.js';
import { getDockerSpawnStrategy } from './docker-spawn-strategy.js';

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
export class ScriptContainerPlugin implements AgentPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Script Container',
    description: 'Runs a deterministic script or inline code inside a Docker container — no LLM involved.',
    inputDescription: 'Step input JSON mounted at /output/input.json inside the container.',
    outputDescription: 'Container writes result to /output/result.json; parsed and emitted as the step result.',
    roles: ['executor'],
  };

  private context!: AgentContext;
  private image!: string;
  private commandArgs!: string[];
  private commandDisplay!: string;
  private inlineScript: string | null = null;
  private runtime: string | null = null;
  private resolvedEnv: ResolvedEnv = { vars: {}, injectedKeys: [] };

  async initialize(context: AgentContext): Promise<void> {
    this.context = context;

    const stepConfig = context.config.stepConfigs.find(
      (sc: StepConfig) => sc.stepId === context.stepId,
    );

    if (!stepConfig) {
      throw new Error(`Step config not found for stepId '${context.stepId}'`);
    }

    const agentConfig: AgentConfig | undefined = stepConfig.agentConfig;
    if (!agentConfig) {
      throw new Error(
        `No agentConfig found for step '${context.stepId}'. ` +
        `ScriptContainerPlugin requires agentConfig with command or inlineScript.`,
      );
    }

    if (agentConfig.inlineScript) {
      // Inline script mode — resolve runtime, image, and command automatically
      const runtime = agentConfig.runtime;
      if (!runtime) {
        throw new Error(
          `agentConfig.runtime is required when using inlineScript for step '${context.stepId}'. ` +
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
          `No Docker image configured in agentConfig for step '${context.stepId}'. ` +
          'ScriptContainerPlugin requires agentConfig.image when using command mode.',
        );
      }
      this.image = agentConfig.image;
      this.commandArgs = agentConfig.command.split(' ');
      this.commandDisplay = agentConfig.command;
    } else {
      throw new Error(
        `No command or inlineScript configured for step '${context.stepId}'. ` +
        'ScriptContainerPlugin requires either agentConfig.command or agentConfig.inlineScript.',
      );
    }

    // Resolve env vars from config (same mechanism as BaseContainerAgentPlugin)
    this.resolvedEnv = resolveStepEnv(context.config.env, stepConfig.env);
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
      // Create temp directory for container /output mount
      const rawOutputDir = await mkdtemp(join(tmpdir(), 'mediforce-script-output-'));
      outputDir = await realpath(rawOutputDir);

      // Write step input as /output/input.json
      const inputPath = join(outputDir, 'input.json');
      await writeFile(inputPath, JSON.stringify(this.context.stepInput, null, 2), 'utf-8');

      // Write inline script to /output/script.{ext}
      if (this.inlineScript && this.runtime) {
        const runtimeCfg = RUNTIME_CONFIG[this.runtime];
        const scriptPath = join(outputDir, `script${runtimeCfg.ext}`);
        await writeFile(scriptPath, this.inlineScript, 'utf-8');
      }

      const timeoutMs = DEFAULT_TIMEOUT_MS;
      const containerName = `mediforce-script-${this.context.processInstanceId}-${this.context.stepId}`.slice(0, 63);

      const envFlags: string[] = [];
      for (const [key, value] of Object.entries(this.resolvedEnv.vars)) {
        envFlags.push('-e', `${key}=${value}`);
      }

      const dockerArgs: string[] = [
        'run', '--rm',
        '--name', containerName,
        '--memory', '4g',
        '--cpus', '2',
        '-v', `${outputDir}:/output`,
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
      // Clean up output dir before re-throwing
      if (outputDir) {
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
