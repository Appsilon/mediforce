import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryCoworkSessionRepository,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../index.js';

/**
 * Integration test: full cowork lifecycle
 *
 * Tests the engine side of cowork:
 * 1. advanceStep routes to cowork step
 * 2. Session creation is simulated (in prod: auto-runner handles this)
 * 3. Finalize: advance with artifact → workflow completes
 */

const coworkDesignerDef: WorkflowDefinition = {
  name: 'cowork-designer-test',
  version: 1,
  steps: [
    {
      id: 'intake',
      name: 'Intake',
      type: 'creation',
      executor: 'human',
    },
    {
      id: 'design',
      name: 'Design Together',
      type: 'creation',
      executor: 'cowork',
      allowedRoles: ['designer'],
      cowork: {
        agent: 'chat',
        chat: { model: 'anthropic/claude-sonnet-4' },
        systemPrompt: 'Help design a workflow.',
        outputSchema: {
          type: 'object',
          required: ['name', 'steps'],
          properties: {
            name: { type: 'string' },
            steps: { type: 'array' },
          },
        },
      },
    },
    {
      id: 'done',
      name: 'Done',
      type: 'terminal',
      executor: 'human',
    },
  ],
  transitions: [
    { from: 'intake', to: 'design' },
    { from: 'design', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

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

  await processRepo.saveWorkflowDefinition(coworkDesignerDef);

  engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined,
    undefined,
    undefined,
    humanTaskRepo,
    coworkSessionRepo,
  );
});

describe('Cowork lifecycle: route → simulate session → finalize → complete', () => {
  it('routes to cowork step, then completes when artifact is provided', async () => {
    // 1. Create and start instance
    const instance = await engine.createInstance(
      'cowork-designer-test',
      1,
      'user-001',
      'manual',
    );
    await engine.startInstance(instance.id);

    expect((await instanceRepo.getById(instance.id))!.currentStepId).toBe('intake');

    // 2. Advance past intake → lands on cowork step
    const afterIntake = await engine.advanceStep(
      instance.id,
      { idea: 'safety review workflow' },
      { id: 'user-001', role: 'designer' },
    );

    expect(afterIntake.currentStepId).toBe('design');

    // 3. Simulate what auto-runner would do: create session + pause
    const session = {
      id: 'session-test',
      processInstanceId: instance.id,
      stepId: 'design',
      assignedRole: 'designer',
      assignedUserId: null,
      status: 'active' as const,
      agent: 'chat' as const,
      model: 'anthropic/claude-sonnet-4',
      systemPrompt: 'Help design a workflow.',
      outputSchema: coworkDesignerDef.steps[1].cowork!.outputSchema!,
      voiceConfig: null,
      artifact: null,
      turns: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finalizedAt: null,
    };
    await coworkSessionRepo.create(session);

    // 4. Simulate conversation + artifact
    await coworkSessionRepo.addTurn(session.id, {
      id: 'turn-1',
      role: 'human',
      content: 'I want a safety review process',
      timestamp: new Date().toISOString(),
      artifactDelta: null,
    });

    const artifact = {
      name: 'safety-review',
      version: 1,
      steps: [
        { id: 'intake', name: 'Intake', type: 'creation', executor: 'human' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'intake', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    await coworkSessionRepo.finalize(session.id, artifact);

    // 5. Advance with finalized artifact
    const afterFinalize = await engine.advanceStep(
      instance.id,
      artifact,
      { id: 'user-001', role: 'designer' },
    );

    expect(afterFinalize.status).toBe('completed');
    expect(afterFinalize.variables['design']).toEqual(artifact);

    // Session should be finalized
    const finalSession = await coworkSessionRepo.getById(session.id);
    expect(finalSession!.status).toBe('finalized');
  });

  it('preserves step context in instance variables after cowork finalize', async () => {
    const instance = await engine.createInstance(
      'cowork-designer-test',
      1,
      'user-001',
      'manual',
    );
    await engine.startInstance(instance.id);

    // Advance past intake with data
    await engine.advanceStep(
      instance.id,
      { idea: 'test workflow', priority: 'high' },
      { id: 'user-001', role: 'designer' },
    );

    const paused = await instanceRepo.getById(instance.id);
    expect(paused!.variables['intake']).toEqual({ idea: 'test workflow', priority: 'high' });
  });
});
