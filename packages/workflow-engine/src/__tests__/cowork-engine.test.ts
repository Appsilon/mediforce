import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryCoworkSessionRepository,
  CoworkSessionSchema,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../index.js';
import type { StepActor } from '../index.js';

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

const coworkDef: WorkflowDefinition = {
  name: 'cowork-process',
  version: 1,
  steps: [
    { id: 'intake', name: 'Intake', type: 'creation', executor: 'human' },
    {
      id: 'design',
      name: 'Design Together',
      type: 'creation',
      executor: 'cowork',
      allowedRoles: ['analyst'],
      cowork: {
        model: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Help design a workflow definition.',
        outputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'intake', to: 'design' },
    { from: 'design', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

const coworkFirstDef: WorkflowDefinition = {
  name: 'cowork-first',
  version: 1,
  steps: [
    {
      id: 'brainstorm',
      name: 'Brainstorm',
      type: 'creation',
      executor: 'cowork',
      allowedRoles: ['designer'],
    },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'brainstorm', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const actor: StepActor = { id: 'user-001', role: 'analyst' };

let processRepo: InMemoryProcessRepository;
let instanceRepo: InMemoryProcessInstanceRepository;
let auditRepo: InMemoryAuditRepository;
let humanTaskRepo: InMemoryHumanTaskRepository;
let coworkSessionRepo: InMemoryCoworkSessionRepository;
let engine: WorkflowEngine;

beforeEach(async () => {
  processRepo = new InMemoryProcessRepository();
  instanceRepo = new InMemoryProcessInstanceRepository();
  auditRepo = new InMemoryAuditRepository();
  humanTaskRepo = new InMemoryHumanTaskRepository();
  coworkSessionRepo = new InMemoryCoworkSessionRepository();

  await processRepo.saveWorkflowDefinition(coworkDef);
  await processRepo.saveWorkflowDefinition(coworkFirstDef);

  engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined, // rbacService
    undefined, // handoffRepository
    undefined, // notificationService
    humanTaskRepo,
    coworkSessionRepo,
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cowork executor: advanceStep routes to cowork step', () => {
  it('advances to a cowork step (session creation is auto-runner responsibility)', async () => {
    const instance = await engine.createInstance('cowork-process', 1, 'user-001', 'manual');
    await engine.startInstance(instance.id);

    // Advance past intake → lands on cowork step
    const updated = await engine.advanceStep(instance.id, { idea: 'safety review' }, actor);

    // Engine advances to the step — auto-runner will create session and pause
    expect(updated.currentStepId).toBe('design');

    // No session created by engine (auto-runner handles this)
    const sessions = await coworkSessionRepo.getByInstanceId(instance.id);
    expect(sessions).toHaveLength(0);
  });

  it('cowork step accepts output and advances to next step', async () => {
    const instance = await engine.createInstance('cowork-process', 1, 'user-001', 'manual');
    await engine.startInstance(instance.id);

    // Advance to cowork step
    await engine.advanceStep(instance.id, { idea: 'test' }, actor);

    // Simulate finalize: advance with artifact as output
    const artifact = { name: 'my-workflow', steps: [], transitions: [], triggers: [] };
    const afterFinalize = await engine.advanceStep(instance.id, artifact, actor);

    expect(afterFinalize.status).toBe('completed');
    expect(afterFinalize.variables['design']).toEqual(artifact);
  });
});

describe('CoworkSession schema validation', () => {
  it('validates a well-formed CoworkSession', () => {
    const session = {
      id: 'session-001',
      processInstanceId: 'inst-001',
      stepId: 'design',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'active',
      model: 'anthropic/claude-sonnet-4',
      systemPrompt: 'Help.',
      outputSchema: null,
      artifact: null,
      turns: [],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      finalizedAt: null,
    };

    const result = CoworkSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  it('validates a session with turns and artifact', () => {
    const session = {
      id: 'session-002',
      processInstanceId: 'inst-001',
      stepId: 'design',
      assignedRole: 'analyst',
      assignedUserId: 'user-001',
      status: 'finalized',
      model: null,
      systemPrompt: null,
      outputSchema: null,
      artifact: { name: 'my-workflow', steps: [] },
      turns: [
        {
          id: 'turn-1',
          role: 'human',
          content: 'I want a safety review process',
          timestamp: '2026-01-15T10:01:00Z',
          artifactDelta: null,
        },
        {
          id: 'turn-2',
          role: 'agent',
          content: 'Here is a draft workflow definition.',
          timestamp: '2026-01-15T10:01:05Z',
          artifactDelta: { name: 'safety-review' },
        },
      ],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:01:05Z',
      finalizedAt: '2026-01-15T10:02:00Z',
    };

    const result = CoworkSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const session = {
      id: 'session-003',
      processInstanceId: 'inst-001',
      stepId: 'design',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'invalid_status',
      model: null,
      systemPrompt: null,
      outputSchema: null,
      artifact: null,
      turns: [],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      finalizedAt: null,
    };

    const result = CoworkSessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });
});

describe('InMemoryCoworkSessionRepository', () => {
  it('creates and retrieves a session', async () => {
    const session = {
      id: 'session-test',
      processInstanceId: 'inst-test',
      stepId: 'step-1',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'active' as const,
      model: null,
      systemPrompt: null,
      outputSchema: null,
      artifact: null,
      turns: [],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      finalizedAt: null,
    };

    await coworkSessionRepo.create(session);
    const retrieved = await coworkSessionRepo.getById('session-test');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('session-test');
    expect(retrieved!.status).toBe('active');
  });

  it('adds a turn to a session', async () => {
    const session = {
      id: 'session-turns',
      processInstanceId: 'inst-test',
      stepId: 'step-1',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'active' as const,
      model: null,
      systemPrompt: null,
      outputSchema: null,
      artifact: null,
      turns: [],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      finalizedAt: null,
    };

    await coworkSessionRepo.create(session);

    const updated = await coworkSessionRepo.addTurn('session-turns', {
      id: 'turn-1',
      role: 'human',
      content: 'Hello agent',
      timestamp: '2026-01-15T10:01:00Z',
      artifactDelta: null,
    });

    expect(updated.turns).toHaveLength(1);
    expect(updated.turns[0].content).toBe('Hello agent');
  });

  it('finalizes a session with artifact', async () => {
    const session = {
      id: 'session-finalize',
      processInstanceId: 'inst-test',
      stepId: 'step-1',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'active' as const,
      model: null,
      systemPrompt: null,
      outputSchema: null,
      artifact: null,
      turns: [],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      finalizedAt: null,
    };

    await coworkSessionRepo.create(session);
    const finalized = await coworkSessionRepo.finalize('session-finalize', { result: 'done' });

    expect(finalized.status).toBe('finalized');
    expect(finalized.artifact).toEqual({ result: 'done' });
    expect(finalized.finalizedAt).not.toBeNull();
  });

  it('abandons a session', async () => {
    const session = {
      id: 'session-abandon',
      processInstanceId: 'inst-test',
      stepId: 'step-1',
      assignedRole: 'analyst',
      assignedUserId: null,
      status: 'active' as const,
      model: null,
      systemPrompt: null,
      outputSchema: null,
      artifact: null,
      turns: [],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      finalizedAt: null,
    };

    await coworkSessionRepo.create(session);
    const abandoned = await coworkSessionRepo.abandon('session-abandon');

    expect(abandoned.status).toBe('abandoned');
  });

  it('throws when accessing non-existent session', async () => {
    await expect(coworkSessionRepo.addTurn('nonexistent', {
      id: 'turn-1',
      role: 'human',
      content: 'Hello',
      timestamp: '2026-01-15T10:00:00Z',
      artifactDelta: null,
    })).rejects.toThrow('CoworkSession not found');
  });
});

describe('Cowork executor type in WorkflowDefinition', () => {
  it('accepts cowork executor in step definition', () => {
    const def = coworkDef;
    const coworkStep = def.steps.find((s) => s.executor === 'cowork');
    expect(coworkStep).toBeDefined();
    expect(coworkStep!.id).toBe('design');
    expect(coworkStep!.cowork).toBeDefined();
    expect(coworkStep!.cowork!.model).toBe('anthropic/claude-sonnet-4');
  });
});
