import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildProcessDefinition,
  buildProcessInstance,
  buildStepExecution,
  buildHumanTask,
  buildAgentRun,
  buildAuditEvent,
  buildProcessConfig,
  buildAgentOutputEnvelope,
  buildFileMetadata,
  resetFactorySequence,
} from '../factories.js';
import {
  ProcessDefinitionSchema,
  ProcessInstanceSchema,
  StepExecutionSchema,
  HumanTaskSchema,
  AgentRunSchema,
  AuditEventSchema,
  ProcessConfigSchema,
  AgentOutputEnvelopeSchema,
  FileMetadataSchema,
} from '../../schemas/index.js';

beforeEach(() => {
  resetFactorySequence();
});

// ---------------------------------------------------------------------------
// buildProcessDefinition
// ---------------------------------------------------------------------------

describe('buildProcessDefinition', () => {
  it('should produce a valid ProcessDefinition', () => {
    const def = buildProcessDefinition();
    const result = ProcessDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const def = buildProcessDefinition({
      name: 'custom-process',
      version: '3.0',
      description: 'A custom description',
    });
    expect(def.name).toBe('custom-process');
    expect(def.version).toBe('3.0');
    expect(def.description).toBe('A custom description');
    const result = ProcessDefinitionSchema.safeParse(def);
    expect(result.success).toBe(true);
  });

  it('should generate sequential deterministic names', () => {
    const def1 = buildProcessDefinition();
    const def2 = buildProcessDefinition();
    expect(def1.name).toBe('process-proc-def-0001');
    expect(def2.name).toBe('process-proc-def-0002');
  });
});

// ---------------------------------------------------------------------------
// buildProcessInstance
// ---------------------------------------------------------------------------

describe('buildProcessInstance', () => {
  it('should produce a valid ProcessInstance', () => {
    const inst = buildProcessInstance();
    const result = ProcessInstanceSchema.safeParse(inst);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const inst = buildProcessInstance({
      status: 'completed',
      currentStepId: null,
      error: 'Something went wrong',
    });
    expect(inst.status).toBe('completed');
    expect(inst.currentStepId).toBeNull();
    expect(inst.error).toBe('Something went wrong');
    const result = ProcessInstanceSchema.safeParse(inst);
    expect(result.success).toBe(true);
  });

  it('should generate sequential deterministic IDs', () => {
    const inst1 = buildProcessInstance();
    const inst2 = buildProcessInstance();
    expect(inst1.id).toBe('inst-0001');
    expect(inst2.id).toBe('inst-0002');
  });
});

// ---------------------------------------------------------------------------
// buildStepExecution
// ---------------------------------------------------------------------------

describe('buildStepExecution', () => {
  it('should produce a valid StepExecution', () => {
    const exec = buildStepExecution();
    const result = StepExecutionSchema.safeParse(exec);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const exec = buildStepExecution({
      status: 'failed',
      error: 'Timeout exceeded',
      output: null,
      completedAt: null,
    });
    expect(exec.status).toBe('failed');
    expect(exec.error).toBe('Timeout exceeded');
    const result = StepExecutionSchema.safeParse(exec);
    expect(result.success).toBe(true);
  });

  it('should accept reviewVerdicts override', () => {
    const exec = buildStepExecution({
      reviewVerdicts: [
        {
          reviewerId: 'user-002',
          reviewerRole: 'approver',
          verdict: 'approve',
          comment: 'Looks good',
          timestamp: '2026-01-15T11:00:00Z',
        },
      ],
    });
    const result = StepExecutionSchema.safeParse(exec);
    expect(result.success).toBe(true);
    expect(exec.reviewVerdicts).toHaveLength(1);
  });

  it('should generate sequential deterministic IDs', () => {
    const e1 = buildStepExecution();
    const e2 = buildStepExecution();
    expect(e1.id).toBe('exec-0001');
    expect(e2.id).toBe('exec-0002');
  });
});

// ---------------------------------------------------------------------------
// buildHumanTask
// ---------------------------------------------------------------------------

describe('buildHumanTask', () => {
  it('should produce a valid HumanTask', () => {
    const task = buildHumanTask();
    const result = HumanTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const task = buildHumanTask({
      status: 'claimed',
      assignedUserId: 'user-042',
      deadline: '2026-02-01T00:00:00Z',
    });
    expect(task.status).toBe('claimed');
    expect(task.assignedUserId).toBe('user-042');
    expect(task.deadline).toBe('2026-02-01T00:00:00Z');
    const result = HumanTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('should generate sequential deterministic IDs', () => {
    const t1 = buildHumanTask();
    const t2 = buildHumanTask();
    expect(t1.id).toBe('task-0001');
    expect(t2.id).toBe('task-0002');
  });
});

// ---------------------------------------------------------------------------
// buildAgentOutputEnvelope
// ---------------------------------------------------------------------------

describe('buildAgentOutputEnvelope', () => {
  it('should produce a valid AgentOutputEnvelope', () => {
    const envelope = buildAgentOutputEnvelope();
    const result = AgentOutputEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const envelope = buildAgentOutputEnvelope({
      confidence: 0.5,
      model: null,
      result: null,
    });
    expect(envelope.confidence).toBe(0.5);
    expect(envelope.model).toBeNull();
    expect(envelope.result).toBeNull();
    const result = AgentOutputEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('should include confidence_rationale in default envelope', () => {
    const envelope = buildAgentOutputEnvelope();
    expect(envelope.confidence_rationale).toBeTypeOf('string');
    expect(envelope.confidence_rationale!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildAgentRun
// ---------------------------------------------------------------------------

describe('buildAgentRun', () => {
  it('should produce a valid AgentRun', () => {
    const run = buildAgentRun();
    const result = AgentRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const run = buildAgentRun({
      status: 'running',
      envelope: null,
      completedAt: null,
      autonomyLevel: 'L0',
    });
    expect(run.status).toBe('running');
    expect(run.envelope).toBeNull();
    expect(run.autonomyLevel).toBe('L0');
    const result = AgentRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('should accept escalated status with fallbackReason', () => {
    const run = buildAgentRun({
      status: 'escalated',
      fallbackReason: 'Confidence below threshold',
    });
    expect(run.fallbackReason).toBe('Confidence below threshold');
    const result = AgentRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('should generate sequential deterministic IDs', () => {
    const r1 = buildAgentRun();
    const r2 = buildAgentRun();
    expect(r1.id).toBe('run-0001');
    expect(r2.id).toBe('run-0002');
  });
});

// ---------------------------------------------------------------------------
// buildAuditEvent
// ---------------------------------------------------------------------------

describe('buildAuditEvent', () => {
  it('should produce a valid AuditEvent', () => {
    const event = buildAuditEvent();
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const event = buildAuditEvent({
      actorType: 'agent',
      actorId: 'agent-001',
      action: 'agent.run.completed',
      processDefinitionVersion: '2.1',
    });
    expect(event.actorType).toBe('agent');
    expect(event.actorId).toBe('agent-001');
    expect(event.processDefinitionVersion).toBe('2.1');
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('should accept system actor type', () => {
    const event = buildAuditEvent({ actorType: 'system', actorId: 'system' });
    const result = AuditEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildProcessConfig
// ---------------------------------------------------------------------------

describe('buildProcessConfig', () => {
  it('should produce a valid ProcessConfig', () => {
    const config = buildProcessConfig();
    const result = ProcessConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const config = buildProcessConfig({
      processName: 'custom-process',
      configName: 'staging',
      configVersion: '2.0',
      roles: ['admin', 'reviewer'],
      notifications: [
        { event: 'task_assigned', roles: ['reviewer'] },
      ],
    });
    expect(config.processName).toBe('custom-process');
    expect(config.configName).toBe('staging');
    expect(config.configVersion).toBe('2.0');
    expect(config.roles).toEqual(['admin', 'reviewer']);
    expect(config.notifications).toHaveLength(1);
    const result = ProcessConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildFileMetadata
// ---------------------------------------------------------------------------

describe('buildFileMetadata', () => {
  it('should produce a valid FileMetadata', () => {
    const file = buildFileMetadata();
    const result = FileMetadataSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('should accept overrides', () => {
    const file = buildFileMetadata({
      name: 'custom-protocol.pdf',
      type: 'application/pdf',
      size: 2048,
    });
    expect(file.name).toBe('custom-protocol.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe(2048);
    const result = FileMetadataSchema.safeParse(file);
    expect(result.success).toBe(true);
  });

  it('should generate sequential deterministic IDs', () => {
    const f1 = buildFileMetadata();
    const f2 = buildFileMetadata();
    expect(f1.id).toBe('file-0001');
    expect(f2.id).toBe('file-0002');
  });
});

// ---------------------------------------------------------------------------
// resetFactorySequence
// ---------------------------------------------------------------------------

describe('resetFactorySequence', () => {
  it('should reset IDs back to 0001 after reset', () => {
    const inst1 = buildProcessInstance();
    expect(inst1.id).toBe('inst-0001');

    const inst2 = buildProcessInstance();
    expect(inst2.id).toBe('inst-0002');

    resetFactorySequence();

    const inst3 = buildProcessInstance();
    expect(inst3.id).toBe('inst-0001');
  });
});

// ---------------------------------------------------------------------------
// Cross-factory integration: all defaults validate
// ---------------------------------------------------------------------------

describe('all factories produce schema-valid defaults', () => {
  const cases: Array<{ name: string; build: () => unknown; schema: { safeParse: (v: unknown) => { success: boolean } } }> = [
    { name: 'ProcessDefinition', build: buildProcessDefinition, schema: ProcessDefinitionSchema },
    { name: 'ProcessInstance', build: buildProcessInstance, schema: ProcessInstanceSchema },
    { name: 'StepExecution', build: buildStepExecution, schema: StepExecutionSchema },
    { name: 'HumanTask', build: buildHumanTask, schema: HumanTaskSchema },
    { name: 'AgentRun', build: buildAgentRun, schema: AgentRunSchema },
    { name: 'AuditEvent', build: buildAuditEvent, schema: AuditEventSchema },
    { name: 'ProcessConfig', build: buildProcessConfig, schema: ProcessConfigSchema },
    { name: 'AgentOutputEnvelope', build: buildAgentOutputEnvelope, schema: AgentOutputEnvelopeSchema },
    { name: 'FileMetadata', build: buildFileMetadata, schema: FileMetadataSchema },
  ];

  for (const { name, build, schema } of cases) {
    it(`${name} default passes Zod validation`, () => {
      const obj = build();
      const result = schema.safeParse(obj);
      expect(result.success).toBe(true);
    });
  }
});
