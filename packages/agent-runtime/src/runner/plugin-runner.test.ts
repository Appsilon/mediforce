import { describe, it, expect } from 'vitest';
import { PluginRunner } from './plugin-runner';
import { InMemoryAgentEventLog } from '../testing/index';
import type { StepExecutorPlugin, AgentContext, EmitFn } from '../interfaces/step-executor-plugin';
import { NoopLlmClient } from '../testing/index';
import type { ProcessConfig, AgentOutputEnvelope } from '@mediforce/platform-core';

function makeProcessConfig(): ProcessConfig {
  return {
    processName: 'test-process',
    configName: 'all-human',
    configVersion: '1',
    stepConfigs: [],
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'step-1',
    processInstanceId: 'instance-1',
    definitionVersion: '1.0.0',
    stepInput: { patientId: 'P001' },
    autonomyLevel: 'L4',
    config: makeProcessConfig(),
    llm: new NoopLlmClient(),
    getPreviousStepOutputs: async () => ({}),
    ...overrides,
  };
}

function makeValidEnvelope(overrides: Partial<AgentOutputEnvelope> = {}): AgentOutputEnvelope {
  return {
    confidence: 0.9,
    reasoning_summary: 'Analysis complete.',
    reasoning_chain: ['loaded', 'analyzed', 'concluded'],
    annotations: [],
    model: 'anthropic/claude-sonnet-4',
    duration_ms: 500,
    result: { recommendation: 'continue' },
    ...overrides,
  };
}

function makeSuccessPlugin(envelope: AgentOutputEnvelope): StepExecutorPlugin {
  return {
    initialize: async () => {},
    run: async (emit: EmitFn) => {
      await emit({
        type: 'status',
        payload: { message: 'Starting' },
        timestamp: new Date().toISOString(),
      });
      await emit({
        type: 'result',
        payload: envelope,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

describe('PluginRunner', () => {
  it('returns result payload on successful execution', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const envelope = makeValidEnvelope();
    const plugin = makeSuccessPlugin(envelope);

    const result = await runner.execute(plugin, makeContext(), 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.errorMessage).toBeNull();
    expect(result.resultPayload).toMatchObject({ confidence: 0.9 });
  });

  it('returns null resultPayload when no result event emitted', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const plugin: StepExecutorPlugin = {
      initialize: async () => {},
      run: async (emit: EmitFn) => {
        await emit({
          type: 'status',
          payload: { message: 'Working...' },
          timestamp: new Date().toISOString(),
        });
      },
    };

    const result = await runner.execute(plugin, makeContext(), 30_000);

    expect(result.resultPayload).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.errorMessage).toBeNull();
  });

  it('returns timedOut: true when plugin exceeds timeout', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const plugin: StepExecutorPlugin = {
      initialize: async () => {},
      run: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      },
    };

    const result = await runner.execute(plugin, makeContext(), 5);

    expect(result.timedOut).toBe(true);
    expect(result.resultPayload).toBeNull();
    expect(result.errorMessage).toBeNull();
  }, 5000);

  it('captures error message when plugin throws', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const plugin: StepExecutorPlugin = {
      initialize: async () => {},
      run: async () => {
        throw new Error('API key invalid');
      },
    };

    const result = await runner.execute(plugin, makeContext(), 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.errorMessage).toBe('API key invalid');
    expect(result.resultPayload).toBeNull();
  });

  it('preserves partial events in event log after plugin throw', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const plugin: StepExecutorPlugin = {
      initialize: async () => {},
      run: async (emit: EmitFn) => {
        await emit({ type: 'status', payload: 'partial', timestamp: new Date().toISOString() });
        throw new Error('crash');
      },
    };

    await runner.execute(plugin, makeContext(), 30_000);

    const events = eventLog.getEvents('instance-1', 'step-1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('status');
  });

  it('captures error when initialize() throws', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const plugin: StepExecutorPlugin = {
      initialize: async () => {
        throw new Error('MCP server unreachable');
      },
      run: async () => {},
    };

    const result = await runner.execute(plugin, makeContext(), 30_000);

    expect(result.timedOut).toBe(false);
    expect(result.errorMessage).toBe('MCP server unreachable');
    expect(result.resultPayload).toBeNull();
  });

  it('returns last result event when multiple result events emitted', async () => {
    const eventLog = new InMemoryAgentEventLog();
    const runner = new PluginRunner(eventLog);
    const plugin: StepExecutorPlugin = {
      initialize: async () => {},
      run: async (emit: EmitFn) => {
        await emit({
          type: 'result',
          payload: { confidence: 0.5, first: true },
          timestamp: new Date().toISOString(),
        });
        await emit({
          type: 'result',
          payload: { confidence: 0.9, last: true },
          timestamp: new Date().toISOString(),
        });
      },
    };

    const result = await runner.execute(plugin, makeContext(), 30_000);

    expect(result.resultPayload).toMatchObject({ confidence: 0.9, last: true });
  });
});
