import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../..');

const REFERENCE_OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  'apps/protocol-to-tfl/data/outputs/cdiscpilot01-outputs/cdiscpilot01-trial-metadata.json',
);

const SKILLS_DIR = resolve(
  PROJECT_ROOT,
  'apps/protocol-to-tfl/plugins/protocol-to-tfl/skills',
);

const PROCESS_CONFIG: ProcessConfig = {
  processName: 'protocol-to-tfl',
  configName: 'agent-extract',
  configVersion: '1',
  stepConfigs: [
    { stepId: 'upload-documents', executorType: 'human' },
    {
      stepId: 'extract-metadata',
      executorType: 'agent',
      plugin: 'claude-code-agent',
      autonomyLevel: 'L3',
      confidenceThreshold: 0.7,
      fallbackBehavior: 'escalate_to_human',
      timeoutMinutes: 15,
      agentConfig: {
        skill: 'trial-metadata-extractor',
        skillsDir: SKILLS_DIR,
        model: 'sonnet',
      },
    },
    { stepId: 'review-metadata', executorType: 'human' },
  ],
};

const STEP_INPUT = {
  filePaths: [
    'apps/protocol-to-tfl/data/test-docs/cdiscpilot01/cdiscpilot01-protocol.pdf',
    'apps/protocol-to-tfl/data/test-docs/cdiscpilot01/cdiscpilot01-sap.pdf',
  ],
};

class StubClaudeCodeAgentPlugin extends ClaudeCodeAgentPlugin {
  constructor(private stubOutputPath: string) {
    super();
  }

  protected override async spawnClaudeCli(
    _prompt: string,
    _options?: { model?: string },
  ): Promise<string> {
    return readFile(this.stubOutputPath, 'utf-8');
  }
}

function buildContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'extract-metadata',
    processInstanceId: 'pi-e2e-001',
    definitionVersion: '1',
    stepInput: STEP_INPUT,
    autonomyLevel: 'L3',
    config: PROCESS_CONFIG,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
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
  confidence: number;
  reasoning_summary: string;
  reasoning_chain: string[];
  annotations: unknown[];
  model: string;
  duration_ms: number;
  result: Record<string, unknown>;
}

describe('ClaudeCodeAgentPlugin E2E', () => {
  describe('stub CLI', () => {
    let plugin: StubClaudeCodeAgentPlugin;

    beforeAll(() => {
      plugin = new StubClaudeCodeAgentPlugin(REFERENCE_OUTPUT_PATH);
    });

    it('[E2E] runs extract-metadata workflow and emits status event mentioning skill name', async () => {
      const context = buildContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const statusEvents = events.filter((event) => event.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0].payload).toContain('trial-metadata-extractor');
    });

    it('[E2E] emits result event with confidence > 0', async () => {
      const context = buildContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((event) => event.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.confidence).toBeGreaterThan(0);
    });

    it('[E2E] result payload contains study_identification and study_design keys', async () => {
      const context = buildContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((event) => event.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      const result = payload.result;
      expect(result).toHaveProperty('study_identification');
      expect(result).toHaveProperty('study_design');
    });

    it('[E2E] result reasoning_summary mentions success', async () => {
      const context = buildContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((event) => event.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.reasoning_summary).toMatch(/completed successfully/i);
    });

    it('[E2E] result duration_ms is a positive number', async () => {
      const context = buildContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((event) => event.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as ResultPayload;
      expect(payload.duration_ms).toBeTypeOf('number');
      expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('real CLI', () => {
    it.skipIf(!process.env['REAL_CLI'])(
      '[E2E] runs extract-metadata workflow with real claude CLI',
      { timeout: 15 * 60_000 },
      async () => {
        const plugin = new ClaudeCodeAgentPlugin();
        const context = buildContext();
        await plugin.initialize(context);

        const { emit, events } = buildEmitSpy();
        await plugin.run(emit);

        const statusEvents = events.filter((event) => event.type === 'status');
        expect(statusEvents.length).toBeGreaterThanOrEqual(1);
        expect(statusEvents[0].payload).toContain('trial-metadata-extractor');

        const resultEvent = events.find((event) => event.type === 'result');
        expect(resultEvent).toBeDefined();

        const payload = resultEvent!.payload as ResultPayload;
        expect(payload.confidence).toBeGreaterThan(0);
        expect(payload.result).toHaveProperty('study_identification');
        expect(payload.result).toHaveProperty('study_design');
        expect(payload.reasoning_summary).toMatch(/completed successfully/i);
        expect(payload.duration_ms).toBeTypeOf('number');
        expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
      },
    );
  });
});
