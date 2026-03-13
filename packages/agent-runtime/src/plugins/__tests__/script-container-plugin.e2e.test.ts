import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { ScriptContainerPlugin } from '../script-container-plugin.js';

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = isDockerAvailable();

function buildContext(
  runtime: string,
  inlineScript: string,
): AgentContext {
  return {
    stepId: 'run-script',
    processInstanceId: 'pi-e2e-runtime',
    definitionVersion: '1',
    stepInput: { test: true, runtime },
    autonomyLevel: 'L0',
    config: {
      processName: 'runtime-test',
      configName: 'default',
      configVersion: '1',
      stepConfigs: [
        {
          stepId: 'run-script',
          executorType: 'script',
          plugin: 'script-container',
          agentConfig: { inlineScript, runtime: runtime as 'javascript' | 'python' | 'r' | 'bash' },
        },
      ],
    } satisfies ProcessConfig,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
  };
}

function buildEmitSpy(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = vi.fn(async (event: EmitPayload) => {
    events.push(event);
  });
  return { emit, events };
}

interface ResultPayload {
  result: Record<string, unknown>;
  confidence: number;
  duration_ms: number;
}

describe('ScriptContainerPlugin E2E — Docker runtimes', () => {
  let plugin: ScriptContainerPlugin;

  beforeEach(() => {
    plugin = new ScriptContainerPlugin();
  });

  it.skipIf(!hasDocker)(
    '[E2E] JavaScript: node:20-slim runs inline script and writes result.json',
    { timeout: 120_000 },
    async () => {
      const script = [
        'import { readFileSync, writeFileSync } from "fs";',
        'const input = JSON.parse(readFileSync("/output/input.json", "utf-8"));',
        'writeFileSync("/output/result.json", JSON.stringify({ lang: "javascript", received: input.runtime }));',
      ].join('\n');

      const context = buildContext('javascript', script);
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.result.lang).toBe('javascript');
      expect(payload.result.received).toBe('javascript');
      expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
    },
  );

  it.skipIf(!hasDocker)(
    '[E2E] Python: python:3.12-slim runs inline script and writes result.json',
    { timeout: 120_000 },
    async () => {
      const script = [
        'import json',
        'with open("/output/input.json") as f:',
        '    inp = json.load(f)',
        'with open("/output/result.json", "w") as f:',
        '    json.dump({"lang": "python", "received": inp["runtime"]}, f)',
      ].join('\n');

      const context = buildContext('python', script);
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.result.lang).toBe('python');
      expect(payload.result.received).toBe('python');
    },
  );

  it.skipIf(!hasDocker)(
    '[E2E] R: rocker/r-ver:4 runs inline script and writes result.json',
    { timeout: 120_000 },
    async () => {
      // Use only base R — no external packages
      const script = [
        'txt <- paste(readLines("/output/input.json"), collapse="")',
        'm <- regmatches(txt, regexpr(\'"runtime"\\\\s*:\\\\s*"[^"]+"\', txt))',
        'val <- sub(\'.*"([^"]+)"$\', "\\\\1", m)',
        'cat(sprintf(\'{"lang":"r","received":"%s"}\', val), file="/output/result.json")',
      ].join('\n');

      const context = buildContext('r', script);
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.result.lang).toBe('r');
      expect(payload.result.received).toBe('r');
    },
  );

  it.skipIf(!hasDocker)(
    '[E2E] Bash: alpine:3.19 runs inline script and writes result.json',
    { timeout: 120_000 },
    async () => {
      const script = [
        '#!/bin/bash',
        'RUNTIME=$(cat /output/input.json | sed -n \'s/.*"runtime"\\s*:\\s*"\\([^"]*\\)".*/\\1/p\')',
        'echo "{\\"lang\\":\\"bash\\",\\"received\\":\\"$RUNTIME\\"}" > /output/result.json',
      ].join('\n');

      const context = buildContext('bash', script);
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.result.lang).toBe('bash');
      expect(payload.result.received).toBe('bash');
    },
  );
});
