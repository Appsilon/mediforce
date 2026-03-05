import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentRunner,
  PluginRegistry,
  InMemoryAgentEventLog,
  NoopLlmClient,
} from '@mediforce/agent-runtime';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  type ProcessConfig,
} from '@mediforce/platform-core';
import { ExampleAgent } from './example-agent.js';

describe('ExampleAgent integration', () => {
  let registry: PluginRegistry;
  let runner: AgentRunner;
  let eventLog: InMemoryAgentEventLog;
  let auditRepo: InMemoryAuditRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    registry = new PluginRegistry();
    eventLog = new InMemoryAgentEventLog();
    auditRepo = new InMemoryAuditRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    runner = new AgentRunner(instanceRepo, auditRepo, eventLog);

    registry.register('@mediforce/example-agent', new ExampleAgent());
  });

  it('registers and retrieves ExampleAgent by name', () => {
    expect(registry.has('@mediforce/example-agent')).toBe(true);
    expect(registry.get('@mediforce/example-agent')).toBeInstanceOf(ExampleAgent);
  });

  it('runs ExampleAgent at L4 (Autopilot) and returns completed result', async () => {
    const plugin = registry.get('@mediforce/example-agent');
    const config: ProcessConfig = {
      processName: 'example-process',
      version: '1.0.0',
      stepConfigs: [{ stepId: 'analyze', autonomyLevel: 'L4' }],
    };
    const context = {
      stepId: 'analyze',
      processInstanceId: 'inst-1',
      definitionVersion: '1.0.0',
      stepInput: { data: 'test' },
      autonomyLevel: 'L4' as const,
      config,
      llm: new NoopLlmClient(),
      getPreviousStepOutputs: async () => ({}),
    };
    const stepConfig = { stepId: 'analyze', autonomyLevel: 'L4' as const };

    const result = await runner.run(plugin, context, stepConfig);

    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(true);
    expect(result.envelope).not.toBeNull();
    expect(result.envelope!.confidence).toBe(0.9);
    expect(result.envelope!.reasoning_summary).toContain('complete');
    expect(result.fallbackReason).toBeNull();
  });

  it('stores status and annotation events before the result event', async () => {
    const plugin = registry.get('@mediforce/example-agent');
    const context = {
      stepId: 'analyze',
      processInstanceId: 'inst-2',
      definitionVersion: '1.0.0',
      stepInput: {},
      autonomyLevel: 'L0' as const,
      config: { processName: 'p', version: '1.0.0', stepConfigs: [] },
      llm: new NoopLlmClient(),
      getPreviousStepOutputs: async () => ({}),
    };

    await runner.run(plugin, context, { stepId: 'analyze' });

    const events = eventLog.getEvents('inst-2', 'analyze');
    expect(events.length).toBeGreaterThanOrEqual(3); // status + annotation + result
    expect(events[0].type).toBe('status');
    expect(events[1].type).toBe('annotation');
    expect(events[events.length - 1].type).toBe('result');
  });

  it('appends audit event with actorType agent after run (COMP-05)', async () => {
    const plugin = registry.get('@mediforce/example-agent');
    const context = {
      stepId: 'analyze',
      processInstanceId: 'inst-3',
      definitionVersion: '1.0.0',
      stepInput: { source: 'test' },
      autonomyLevel: 'L4' as const,
      config: { processName: 'p', version: '1.0.0', stepConfigs: [] },
      llm: new NoopLlmClient(),
      getPreviousStepOutputs: async () => ({}),
    };

    await runner.run(plugin, context, { stepId: 'analyze', autonomyLevel: 'L4' });

    const auditEvents = auditRepo.getAll();
    expect(auditEvents).toHaveLength(1);
    const auditEvent = auditEvents[0];
    expect(auditEvent.actorType).toBe('agent');
    expect(auditEvent.outputSnapshot).toHaveProperty('confidence');
    expect(auditEvent.outputSnapshot).toHaveProperty('model');
    expect(auditEvent.outputSnapshot).toHaveProperty('duration_ms');
    expect(auditEvent.outputSnapshot).toHaveProperty('reasoning_summary');
  });

  it('runs ExampleAgent at L0 (Silent Observer) — appliedToWorkflow is false', async () => {
    const plugin = registry.get('@mediforce/example-agent');
    const context = {
      stepId: 'analyze',
      processInstanceId: 'inst-4',
      definitionVersion: '1.0.0',
      stepInput: {},
      autonomyLevel: 'L0' as const,
      config: { processName: 'p', version: '1.0.0', stepConfigs: [] },
      llm: new NoopLlmClient(),
      getPreviousStepOutputs: async () => ({}),
    };

    const result = await runner.run(plugin, context, { stepId: 'analyze', autonomyLevel: 'L0' });

    expect(result.status).toBe('completed');
    expect(result.appliedToWorkflow).toBe(false);
    expect(result.envelope).not.toBeNull();
  });
});
