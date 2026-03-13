import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentPlugin, AgentContext, EmitFn } from '../interfaces/agent-plugin.js';
import type { AgentConfig, StepConfig, PluginCapabilityMetadata } from '@mediforce/platform-core';

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Runtime → Docker image, file extension, and run command. */
const RUNTIME_CONFIG: Record<string, { image: string; ext: string; cmd: (path: string) => string }> = {
  javascript: { image: 'node:20-slim', ext: '.mjs', cmd: (p) => `node ${p}` },
  python: { image: 'python:3.12-slim', ext: '.py', cmd: (p) => `python ${p}` },
  r: { image: 'rocker/r-ver:4', ext: '.R', cmd: (p) => `Rscript ${p}` },
  bash: { image: 'alpine:3.19', ext: '.sh', cmd: (p) => `sh ${p}` },
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
  private command!: string;
  private inlineScript: string | null = null;
  private runtime: string | null = null;

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
      this.command = runtimeCfg.cmd(scriptPath);
    } else if (agentConfig.command) {
      // Command mode — existing behavior
      if (!agentConfig.image) {
        throw new Error(
          `No Docker image configured in agentConfig for step '${context.stepId}'. ` +
          'ScriptContainerPlugin requires agentConfig.image when using command mode.',
        );
      }
      this.image = agentConfig.image;
      this.command = agentConfig.command;
    } else {
      throw new Error(
        `No command or inlineScript configured for step '${context.stepId}'. ` +
        'ScriptContainerPlugin requires either agentConfig.command or agentConfig.inlineScript.',
      );
    }
  }

  async run(emit: EmitFn): Promise<void> {
    const startTime = Date.now();

    await emit({
      type: 'status',
      payload: `starting script container: image='${this.image}', command='${this.command}'`,
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

      const dockerArgs: string[] = [
        'run', '--rm',
        '--name', containerName,
        '--memory', '4g',
        '--cpus', '2',
        '-v', `${outputDir}:/output`,
        this.image,
        ...this.command.split(' '),
      ];

      console.log(`[ScriptContainer] Spawning: docker ${dockerArgs.join(' ')}`);

      const containerOutput = await new Promise<string>((resolve, reject) => {
        const child = spawn('docker', dockerArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let settled = false;

        const timeoutHandle = setTimeout(() => {
          if (settled) return;
          console.error(`[ScriptContainer] Docker timeout (${Math.round(timeoutMs / 60_000)} min) — killing container`);
          child.kill('SIGTERM');
          spawn('docker', ['kill', containerName], { stdio: 'ignore' }).unref();
        }, timeoutMs);

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => {
          stdoutChunks.push(chunk);
          const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            emit({
              type: 'assistant',
              payload: JSON.stringify({ ts: new Date().toISOString(), type: 'assistant', subtype: 'text', text: line }),
              timestamp: new Date().toISOString(),
            }).catch(() => {});
          }
        });

        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
          const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
          for (const line of lines) {
            emit({
              type: 'assistant',
              payload: JSON.stringify({ ts: new Date().toISOString(), type: 'assistant', subtype: 'text', text: `[stderr] ${line}` }),
              timestamp: new Date().toISOString(),
            }).catch(() => {});
          }
        });

        child.on('error', (error) => {
          reject(new Error(`Docker process failed: ${error.message}`));
        });

        child.on('close', (code, signal) => {
          settled = true;
          clearTimeout(timeoutHandle);

          const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

          if (code !== 0) {
            const exitInfo = signal
              ? `killed by ${signal}`
              : `exit code ${code}`;
            const detail = stderr || stdout || 'no output';
            reject(new Error(`Script container failed (${exitInfo}): ${detail}`));
            return;
          }

          resolve(stdout);
        });

        child.stdin.end();
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
          reasoning_summary: `Script container completed: ${this.command}`,
          reasoning_chain: [
            `Image: ${this.image}`,
            `Command: ${this.command}`,
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
