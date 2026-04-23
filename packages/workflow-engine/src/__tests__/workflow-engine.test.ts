import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  buildWorkflowDefinition,
} from '@mediforce/platform-core';
import type {
  ReviewVerdict,
  HumanTaskRepository,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import {
  WorkflowEngine,
  InvalidTransitionError,
} from '../index.js';
import type { StepActor } from '../index.js';

// All test definitions use WorkflowDefinition (unified schema)
const linearDef: WorkflowDefinition = {
  name: 'linear-process',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'process', name: 'Process', type: 'creation', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'process' },
    { from: 'process', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start Process' }],
};

const branchingDef: WorkflowDefinition = {
  name: 'branching-process',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'path-a', name: 'Path A', type: 'creation', executor: 'agent' },
    { id: 'path-b', name: 'Path B', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'path-a', when: 'output.route == "a"' },
    { from: 'start', to: 'path-b', when: 'output.route == "b"' },
    { from: 'path-a', to: 'done' },
    { from: 'path-b', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start Branching' }],
};

const reviewDef: WorkflowDefinition = {
  name: 'review-process',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'draft', name: 'Draft', type: 'creation', executor: 'agent' },
    {
      id: 'review',
      name: 'Review',
      type: 'review',
      executor: 'human',
      review: { maxIterations: 3 },
      verdicts: {
        approve: { target: 'approved' },
        revise: { target: 'draft' },
        reject: { target: 'rejected' },
      },
    },
    { id: 'approved', name: 'Approved', type: 'terminal', executor: 'human' },
    { id: 'rejected', name: 'Rejected', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'approved' },
    { from: 'review', to: 'draft' },
    { from: 'review', to: 'rejected' },
  ],
  triggers: [{ type: 'manual', name: 'Start Review' }],
};

const actor: StepActor = { id: 'user-1', role: 'operator' };

function makeReviewVerdict(
  verdict: string,
  comment: string | null = null,
): ReviewVerdict {
  return {
    reviewerId: 'reviewer-1',
    reviewerRole: 'qa-lead',
    verdict,
    comment,
    timestamp: new Date().toISOString(),
  };
}

describe('WorkflowEngine', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
    );

    await processRepo.saveWorkflowDefinition(linearDef);
    await processRepo.saveWorkflowDefinition(branchingDef);
    await processRepo.saveWorkflowDefinition(reviewDef);
  });

  // --- createInstance ---

  it('createInstance returns ProcessInstance with status created and correct definition reference', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      { key: 'value' },
    );
    expect(instance.status).toBe('created');
    expect(instance.definitionName).toBe('linear-process');
    expect(instance.definitionVersion).toBe('1');
    expect(instance.createdBy).toBe('user-1');
    expect(instance.triggerType).toBe('manual');
    expect(instance.triggerPayload).toEqual({ key: 'value' });
    expect(instance.currentStepId).toBeNull();
    expect(instance.id).toBeDefined();
    // Unified instances have no configName/configVersion
    expect(instance.configName).toBeUndefined();
    expect(instance.configVersion).toBeUndefined();
  });

  it('createInstance throws if definition not found', async () => {
    await expect(
      engine.createInstance('nonexistent', 99, 'user-1', 'manual'),
    ).rejects.toThrow();
  });

  // --- startInstance ---

  it('startInstance transitions created -> running, sets currentStepId to first step', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    const started = await engine.startInstance(instance.id);
    expect(started.status).toBe('running');
    expect(started.currentStepId).toBe('start');
  });

  // --- advanceStep ---

  it('advanceStep delegates to StepExecutor, commits new state', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    const advanced = await engine.advanceStep(instance.id, { result: 'ok' }, actor);
    expect(advanced.currentStepId).toBe('process');
    expect(advanced.status).toBe('running');
  });

  // --- submitReviewVerdict ---

  it('submitReviewVerdict adds verdict to ReviewTracker, routes via native verdicts', async () => {
    const instance = await engine.createInstance(
      'review-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    // Advance from draft to review
    await engine.advanceStep(instance.id, {}, actor);

    const verdict = makeReviewVerdict('approve');
    const result = await engine.submitReviewVerdict(
      instance.id,
      'review',
      verdict,
      actor,
    );
    // Should route to approved terminal step
    expect(result.status).toBe('completed');
  });

  it('submitReviewVerdict when maxIterations exceeded: pauses instance with reason max_iterations_exceeded', async () => {
    const instance = await engine.createInstance(
      'review-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);

    // maxIterations = 3, so we iterate 3 full loops (revise verdicts),
    // then the 4th submit should trigger max_iterations_exceeded
    for (let i = 0; i < 3; i++) {
      // Advance from draft to review
      await engine.advanceStep(instance.id, {}, actor);
      // Submit revise verdict -- routes back to draft, increments iteration
      await engine.submitReviewVerdict(
        instance.id,
        'review',
        makeReviewVerdict('revise'),
        actor,
      );
    }

    // Now at draft again after 3 iterations. Advance to review.
    await engine.advanceStep(instance.id, {}, actor);

    // This submit should detect max iterations exceeded (3 >= 3)
    await engine.submitReviewVerdict(
      instance.id,
      'review',
      makeReviewVerdict('revise'),
      actor,
    );

    const finalInstance = await instanceRepo.getById(instance.id);
    expect(finalInstance!.status).toBe('paused');
    expect(finalInstance!.pauseReason).toBe('max_iterations_exceeded');

    const events = auditRepo.getAll();
    const maxIterEvent = events.find(
      (e) => e.action === 'review.max_iterations_exceeded',
    );
    expect(maxIterEvent).toBeDefined();
  });

  // --- pauseInstance ---

  it('pauseInstance sets status paused and pauseReason, emits audit event', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    const paused = await engine.pauseInstance(instance.id, 'manual_hold', actor);
    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('manual_hold');

    const events = auditRepo.getAll();
    const pauseEvent = events.find((e) => e.action === 'instance.paused');
    expect(pauseEvent).toBeDefined();
  });

  // --- resumeInstance ---

  it('resumeInstance on paused instance: status back to running, audit event emitted', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    await engine.pauseInstance(instance.id, 'test-reason', actor);
    const resumed = await engine.resumeInstance(instance.id, actor);
    expect(resumed.status).toBe('running');

    const events = auditRepo.getAll();
    const resumeEvent = events.find((e) => e.action === 'instance.resumed');
    expect(resumeEvent).toBeDefined();
  });

  it('resumeInstance on non-paused instance: throws InvalidTransitionError', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    await expect(engine.resumeInstance(instance.id, actor)).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  // --- abortInstance ---

  it('abortInstance sets status failed, audit event emitted', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    const aborted = await engine.abortInstance(instance.id, actor);
    expect(aborted.status).toBe('failed');

    const events = auditRepo.getAll();
    const abortEvent = events.find((e) => e.action === 'instance.aborted');
    expect(abortEvent).toBeDefined();
  });

  // --- Full lifecycle tests ---

  it('full linear flow: createInstance -> startInstance -> advanceStep x2 -> completed', async () => {
    const instance = await engine.createInstance(
      'linear-process',
      1,
      'user-1',
      'manual',
      {},
    );
    expect(instance.status).toBe('created');

    const started = await engine.startInstance(instance.id);
    expect(started.status).toBe('running');
    expect(started.currentStepId).toBe('start');

    // Advance: start -> process
    const step1 = await engine.advanceStep(instance.id, { result: 'step1' }, actor);
    expect(step1.currentStepId).toBe('process');

    // Advance: process -> done (terminal)
    const step2 = await engine.advanceStep(instance.id, { result: 'step2' }, actor);
    expect(step2.status).toBe('completed');
    expect(step2.currentStepId).toBeNull();
  });

  it('full branching flow: when expression routes to correct step based on output', async () => {
    const instance = await engine.createInstance(
      'branching-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);

    // when expression routes to path-b
    const routed = await engine.advanceStep(
      instance.id,
      { route: 'b' },
      actor,
    );
    expect(routed.currentStepId).toBe('path-b');

    // Advance to done
    const completed = await engine.advanceStep(instance.id, {}, actor);
    expect(completed.status).toBe('completed');
  });

  it('full review loop: two revise verdicts then approve -- loops back, then completes', async () => {
    const instance = await engine.createInstance(
      'review-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);

    // Advance: draft -> review
    await engine.advanceStep(instance.id, {}, actor);
    let current = await instanceRepo.getById(instance.id);
    expect(current!.currentStepId).toBe('review');

    // First review: revise -> back to draft
    await engine.submitReviewVerdict(
      instance.id,
      'review',
      makeReviewVerdict('revise', 'Needs more detail'),
      actor,
    );
    current = await instanceRepo.getById(instance.id);
    expect(current!.currentStepId).toBe('draft');

    // Advance: draft -> review again
    await engine.advanceStep(instance.id, {}, actor);
    current = await instanceRepo.getById(instance.id);
    expect(current!.currentStepId).toBe('review');

    // Second review: revise again -> back to draft
    await engine.submitReviewVerdict(
      instance.id,
      'review',
      makeReviewVerdict('revise', 'Still needs work'),
      actor,
    );
    current = await instanceRepo.getById(instance.id);
    expect(current!.currentStepId).toBe('draft');

    // Advance: draft -> review once more
    await engine.advanceStep(instance.id, {}, actor);
    current = await instanceRepo.getById(instance.id);
    expect(current!.currentStepId).toBe('review');

    // Third review: approve -> completed
    await engine.submitReviewVerdict(
      instance.id,
      'review',
      makeReviewVerdict('approve'),
      actor,
    );
    current = await instanceRepo.getById(instance.id);
    expect(current!.status).toBe('completed');
    expect(current!.currentStepId).toBeNull();
  });

  // --- HumanTask creation ---

  describe('HumanTask creation', () => {
    it('creates a HumanTask when advancing to a human step', async () => {
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      const engineWithHumanTasks = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined, // rbacService
        undefined, // handoffRepository
        undefined, // notificationService
        humanTaskRepo,
      );

      const instance = await engineWithHumanTasks.createInstance(
        'linear-process',
        1,
        'user-1',
        'manual',
        {},
      );
      await engineWithHumanTasks.startInstance(instance.id);
      // Advance from 'start' (automated) -> 'process' (human)
      await engineWithHumanTasks.advanceStep(
        instance.id,
        { result: 'done' },
        { id: 'user-1', role: 'operator' },
      );

      const tasks = humanTaskRepo.getAll();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].processInstanceId).toBe(instance.id);
      expect(tasks[0].stepId).toBe('process');
      expect(tasks[0].status).toBe('claimed');
      expect(tasks[0].assignedUserId).toBe('user-1');
    });

    it('does not create HumanTask when humanTaskRepository is not injected', async () => {
      // engine (from beforeEach) has no humanTaskRepository
      const instance = await engine.createInstance(
        'linear-process',
        1,
        'user-1',
        'manual',
        {},
      );
      await engine.startInstance(instance.id);
      // Should not throw
      await expect(
        engine.advanceStep(
          instance.id,
          { result: 'done' },
          { id: 'user-1', role: 'operator' },
        ),
      ).resolves.toBeDefined();
    });

    it('does not create HumanTask when advancing to a terminal step', async () => {
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      const engineWithHumanTasks = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        undefined,
        undefined,
        humanTaskRepo,
      );

      const instance = await engineWithHumanTasks.createInstance(
        'linear-process',
        1,
        'user-1',
        'manual',
        {},
      );
      await engineWithHumanTasks.startInstance(instance.id);
      // Advance start -> process (creates 1 HumanTask + pauses for human input)
      await engineWithHumanTasks.advanceStep(
        instance.id,
        { result: 'done' },
        { id: 'user-1', role: 'operator' },
      );
      // Resume so we can advance past the human step
      await engineWithHumanTasks.resumeInstance(instance.id, { id: 'user-1', role: 'operator' });
      // Advance process -> done (terminal, no new HumanTask)
      await engineWithHumanTasks.advanceStep(
        instance.id,
        { result: 'done' },
        { id: 'user-1', role: 'operator' },
      );

      // Still only 1 task from the first advance
      expect(humanTaskRepo.getAll()).toHaveLength(1);
    });

    it('propagates humanTaskRepository.create() failure as advanceStep failure', async () => {
      class FailingHumanTaskRepository extends InMemoryHumanTaskRepository {
        override async create(_task: import('@mediforce/platform-core').HumanTask): Promise<import('@mediforce/platform-core').HumanTask> {
          throw new Error('Firestore unavailable');
        }
      }
      const failingRepo: HumanTaskRepository = new FailingHumanTaskRepository();
      const engineWithFailingRepo = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        undefined,
        undefined,
        failingRepo,
      );

      const instance = await engineWithFailingRepo.createInstance(
        'linear-process',
        1,
        'user-1',
        'manual',
        {},
      );
      await engineWithFailingRepo.startInstance(instance.id);
      // Advancing to human step will trigger create() which throws
      await expect(
        engineWithFailingRepo.advanceStep(
          instance.id,
          { result: 'done' },
          { id: 'user-1', role: 'operator' },
        ),
      ).rejects.toThrow('Firestore unavailable');
    });

    it('sets assignedRole from WorkflowDefinition step allowedRoles', async () => {
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      const engineWithHumanTasks = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        undefined,
        undefined,
        humanTaskRepo,
      );

      // Save a WorkflowDefinition with allowedRoles on the 'process' step
      const defWithRoles = {
        name: 'linear-process-with-roles',
        version: 1,
        namespace: 'test',
        steps: [
          { id: 'start', name: 'Start', type: 'creation' as const, executor: 'agent' as const },
          { id: 'process', name: 'Process', type: 'creation' as const, executor: 'human' as const, allowedRoles: ['reviewer'] },
          { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
        ],
        transitions: [
          { from: 'start', to: 'process' },
          { from: 'process', to: 'done' },
        ],
        triggers: [{ type: 'manual' as const, name: 'Start' }],
      };
      await processRepo.saveWorkflowDefinition(defWithRoles);

      const instance = await engineWithHumanTasks.createInstance(
        'linear-process-with-roles',
        1,
        'user-1',
        'manual',
        {},
      );
      await engineWithHumanTasks.startInstance(instance.id);
      await engineWithHumanTasks.advanceStep(
        instance.id,
        {},
        { id: 'user-1', role: 'operator' },
      );

      expect(humanTaskRepo.getAll()[0].assignedRole).toBe('reviewer');
    });

    it('resolves assignedRole from WorkflowDefinition step allowedRoles without passing stepConfig', async () => {
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      const engineWithHumanTasks = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        undefined,
        undefined,
        humanTaskRepo,
      );

      // Save a WorkflowDefinition with allowedRoles on the 'process' step
      const defWithRoles = {
        name: 'linear-process-analyst',
        version: 1,
        namespace: 'test',
        steps: [
          { id: 'start', name: 'Start', type: 'creation' as const, executor: 'agent' as const },
          { id: 'process', name: 'Process', type: 'creation' as const, executor: 'human' as const, allowedRoles: ['supply-analyst'] },
          { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
        ],
        transitions: [
          { from: 'start', to: 'process' },
          { from: 'process', to: 'done' },
        ],
        triggers: [{ type: 'manual' as const, name: 'Start' }],
      };
      await processRepo.saveWorkflowDefinition(defWithRoles);

      const instance = await engineWithHumanTasks.createInstance(
        'linear-process-analyst', 1, 'user-1', 'manual', {},
      );
      await engineWithHumanTasks.startInstance(instance.id);
      // Advance from 'start' -> 'process' (human) WITHOUT passing stepConfig
      await engineWithHumanTasks.advanceStep(
        instance.id, { result: 'done' }, { id: 'user-1', role: 'operator' },
      );

      const tasks = humanTaskRepo.getAll();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].assignedRole).toBe('supply-analyst');
    });
  });

  describe('selection review', () => {
    const selectionDef: WorkflowDefinition = {
      name: 'selection-process',
      version: 1,
      namespace: 'test',
      steps: [
        { id: 'generate', name: 'Generate Options', type: 'creation', executor: 'agent' },
        {
          id: 'select-review',
          name: 'Select Review',
          type: 'review',
          executor: 'human',
          allowedRoles: ['reviewer'],
          selection: 2,
          verdicts: {
            approve: { target: 'done' },
            reject: { target: 'done' },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'generate', to: 'select-review' },
        { from: 'select-review', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };

    it('copies selection and options to HumanTask when review step has selection', async () => {
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      const engineWithSelection = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        undefined,
        undefined,
        humanTaskRepo,
      );

      await processRepo.saveWorkflowDefinition(selectionDef);

      const instance = await engineWithSelection.createInstance(
        'selection-process', 1, 'user-1', 'manual', {},
      );
      await engineWithSelection.startInstance(instance.id);

      // Advance from 'generate' -> 'select-review' with options in output
      const optionsPayload = {
        options: [
          { id: 'opt-1', label: 'Option A' },
          { id: 'opt-2', label: 'Option B' },
        ],
      };
      await engineWithSelection.advanceStep(
        instance.id,
        optionsPayload,
        { id: 'user-1', role: 'operator' },
      );

      const tasks = humanTaskRepo.getAll();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].selection).toBe(2);
      expect(tasks[0].options).toEqual([
        { id: 'opt-1', label: 'Option A' },
        { id: 'opt-2', label: 'Option B' },
      ]);
    });

    it('throws when options count violates selection constraint', async () => {
      const humanTaskRepo = new InMemoryHumanTaskRepository();
      const engineWithSelection = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        undefined,
        undefined,
        humanTaskRepo,
      );

      await processRepo.saveWorkflowDefinition(selectionDef);

      const instance = await engineWithSelection.createInstance(
        'selection-process', 1, 'user-1', 'manual', {},
      );
      await engineWithSelection.startInstance(instance.id);

      // Advance with 1 option but selection requires at least 2 (min=2)
      const tooFewOptions = {
        options: [
          { id: 'opt-1', label: 'Option A' },
        ],
      };
      await expect(
        engineWithSelection.advanceStep(
          instance.id,
          tooFewOptions,
          { id: 'user-1', role: 'operator' },
        ),
      ).rejects.toThrow(/options/);
    });
  });
});

// ---------------------------------------------------------------------------
// WorkflowDefinition (unified schema) tests
// ---------------------------------------------------------------------------

const linearWorkflowDef: WorkflowDefinition = {
  name: 'linear-workflow',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'process', name: 'Process', type: 'creation', executor: 'human', allowedRoles: ['operator'] },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'process' },
    { from: 'process', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start Workflow' }],
  roles: ['operator', 'reviewer'],
};

const reviewWorkflowDef: WorkflowDefinition = {
  name: 'review-workflow',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'draft', name: 'Draft', type: 'creation', executor: 'agent' },
    {
      id: 'review',
      name: 'Review',
      type: 'review',
      executor: 'human',
      allowedRoles: ['reviewer'],
      review: { maxIterations: 3 },
      verdicts: {
        approve: { target: 'approved' },
        revise: { target: 'draft' },
        reject: { target: 'rejected' },
      },
    },
    { id: 'approved', name: 'Approved', type: 'terminal', executor: 'human' },
    { id: 'rejected', name: 'Rejected', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'approved' },
    { from: 'review', to: 'draft' },
    { from: 'review', to: 'rejected' },
  ],
  triggers: [{ type: 'manual', name: 'Start Review Workflow' }],
  roles: ['reviewer'],
};

describe('WorkflowEngine — WorkflowDefinition (unified schema)', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    engine = new WorkflowEngine(
      processRepo, instanceRepo, auditRepo,
      undefined, // rbacService
      undefined, // handoffRepository
      undefined, // notificationService
      humanTaskRepo, // humanTaskRepository — needed for HumanTask creation on human step advance
    );

    await processRepo.saveWorkflowDefinition(linearWorkflowDef);
    await processRepo.saveWorkflowDefinition(reviewWorkflowDef);
  });

  // --- createInstance ---

  it('createInstance returns ProcessInstance with status created and no configName/configVersion', async () => {
    const instance = await engine.createInstance(
      'linear-workflow',
      1,
      'user-1',
      'manual',
    );
    expect(instance.status).toBe('created');
    expect(instance.definitionName).toBe('linear-workflow');
    expect(instance.definitionVersion).toBe('1');
    expect(instance.createdBy).toBe('user-1');
    expect(instance.triggerType).toBe('manual');
    expect(instance.currentStepId).toBeNull();
    expect(instance.id).toBeDefined();
    // No configName/configVersion on unified instances
    expect(instance.configName).toBeUndefined();
    expect(instance.configVersion).toBeUndefined();
  });

  it('createInstance uses definition.roles as assignedRoles', async () => {
    const instance = await engine.createInstance(
      'linear-workflow',
      1,
      'user-1',
      'manual',
    );
    expect(instance.assignedRoles).toEqual(['operator', 'reviewer']);
  });

  it('createInstance uses definition roles when no custom roles supplied', async () => {
    const instance = await engine.createInstance(
      'linear-workflow',
      1,
      'user-1',
      'manual',
      {},
    );
    expect(instance.assignedRoles).toEqual(['operator', 'reviewer']);
  });

  it('createInstance throws when definition not found', async () => {
    await expect(
      engine.createInstance('nonexistent', 99, 'user-1', 'manual'),
    ).rejects.toThrow("Workflow definition 'nonexistent' version '99' not found");
  });

  it('createInstance uses payload when provided', async () => {
    const instance = await engine.createInstance(
      'linear-workflow',
      1,
      'user-1',
      'manual',
      { key: 'value' },
    );
    expect(instance.triggerPayload).toEqual({ key: 'value' });
  });

  it('createInstance defaults payload to empty object when omitted', async () => {
    const instance = await engine.createInstance(
      'linear-workflow',
      1,
      'user-1',
      'cron',
    );
    expect(instance.triggerPayload).toEqual({});
    expect(instance.triggerType).toBe('cron');
  });

  // --- advanceStep ---

  it('advanceStep delegates to StepExecutor, advances to next step and pauses for human', async () => {
    const instance = await engine.createInstance('linear-workflow', 1, 'user-1', 'manual');
    await engine.startInstance(instance.id);

    const advanced = await engine.advanceStep(instance.id, { result: 'ok' }, actor);
    expect(advanced.currentStepId).toBe('process');
    // Next step is human → engine creates HumanTask and pauses
    expect(advanced.status).toBe('paused');
  });

  it('advanceStep throws InvalidTransitionError when instance is not running', async () => {
    const instance = await engine.createInstance('linear-workflow', 1, 'user-1', 'manual');
    // Not started yet — status is 'created'
    await expect(
      engine.advanceStep(instance.id, {}, actor),
    ).rejects.toThrow(InvalidTransitionError);
  });

  // --- full lifecycle with WorkflowDefinition ---

  it('full linear flow with createInstance -> startInstance -> advanceStep -> resume -> advance -> completed', async () => {
    const instance = await engine.createInstance('linear-workflow', 1, 'user-1', 'manual');
    expect(instance.status).toBe('created');

    const started = await engine.startInstance(instance.id);
    expect(started.status).toBe('running');
    expect(started.currentStepId).toBe('start');

    // Advance: start -> process (human step → pauses)
    const step1 = await engine.advanceStep(instance.id, { result: 'step1' }, actor);
    expect(step1.currentStepId).toBe('process');
    expect(step1.status).toBe('paused');

    // Resume (simulates human completing the task)
    await engine.resumeInstance(instance.id, actor);

    // Advance: process -> done (terminal)
    const step2 = await engine.advanceStep(instance.id, { result: 'step2' }, actor);
    expect(step2.status).toBe('completed');
    expect(step2.currentStepId).toBeNull();
  });

  it('buildWorkflowDefinition factory produces a valid saveable definition', async () => {
    const def = buildWorkflowDefinition({ name: 'factory-workflow', version: 2 });
    await processRepo.saveWorkflowDefinition(def);

    const instance = await engine.createInstance('factory-workflow', 2, 'user-1', 'manual');
    expect(instance.definitionName).toBe('factory-workflow');
    expect(instance.definitionVersion).toBe('2');
  });

  // --- HumanTask creation with WorkflowDefinition ---

  it('advanceStep creates HumanTask for next human executor step', async () => {
    const humanTaskRepo = new InMemoryHumanTaskRepository();
    const engineWithTasks = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      undefined,
      undefined,
      humanTaskRepo,
    );

    const instance = await engineWithTasks.createInstance(
      'linear-workflow',
      1,
      'user-1',
      'manual',
    );
    await engineWithTasks.startInstance(instance.id);

    // Advance from 'start' (agent) -> 'process' (human)
    await engineWithTasks.advanceStep(
      instance.id,
      { result: 'done' },
      { id: 'user-1', role: 'operator' },
    );

    const tasks = humanTaskRepo.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].processInstanceId).toBe(instance.id);
    expect(tasks[0].stepId).toBe('process');
    expect(tasks[0].assignedRole).toBe('operator');
    expect(tasks[0].status).toBe('claimed');
    expect(tasks[0].assignedUserId).toBe('user-1');
  });

  it('advanceStep pauses instance when advancing to a human step', async () => {
    const humanTaskRepo = new InMemoryHumanTaskRepository();
    const engineWithTasks = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      undefined,
      undefined,
      humanTaskRepo,
    );

    const instance = await engineWithTasks.createInstance('linear-workflow', 1, 'user-1', 'manual');
    await engineWithTasks.startInstance(instance.id);
    await engineWithTasks.advanceStep(instance.id, {}, actor);

    const updated = await instanceRepo.getById(instance.id);
    expect(updated!.status).toBe('paused');
    expect(updated!.pauseReason).toBe('waiting_for_human');
  });

  // --- review flow with WorkflowDefinition ---

  it('review flow: advanceStep then submitReviewVerdict routes via verdicts', async () => {
    const instance = await engine.createInstance('review-workflow', 1, 'user-1', 'manual');
    await engine.startInstance(instance.id);

    // Advance: draft -> review (human step → pauses)
    const advanced = await engine.advanceStep(instance.id, {}, actor);
    expect(advanced.currentStepId).toBe('review');
    expect(advanced.status).toBe('paused');

    // Resume (simulates human picking up the review task)
    await engine.resumeInstance(instance.id, actor);

    // Approve: should route to approved (terminal)
    await engine.submitReviewVerdict(
      instance.id,
      'review',
      makeReviewVerdict('approve'),
      actor,
    );
    const current = await instanceRepo.getById(instance.id);
    expect(current!.status).toBe('completed');
  });

  // ---- Autonomy level step advancement tests ----

  const autonomyTestDef: WorkflowDefinition = {
    name: 'autonomy-test',
    version: 1,
    namespace: 'test',
    steps: [
      { id: 'agent-step', name: 'Agent Step', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
      { id: 'human-step', name: 'Human Review', type: 'creation', executor: 'human', allowedRoles: ['reviewer'] },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [
      { from: 'agent-step', to: 'human-step' },
      { from: 'human-step', to: 'done' },
    ],
    triggers: [{ type: 'manual', name: 'Start' }],
  };

  it('[DATA] advanceStep after L2 agent completion routes to next human step and pauses', async () => {
    await processRepo.saveWorkflowDefinition(autonomyTestDef);
    const instance = await engine.createInstance('autonomy-test', 1, 'user-1', 'manual');
    await engine.startInstance(instance.id);

    // Simulate: L2 agent completes, then advance is called (this is what the fix does)
    const updated = await engine.advanceStep(
      instance.id,
      { result: 'agent output' },
      actor,
    );

    // Should have advanced to human-step and paused
    expect(updated.currentStepId).toBe('human-step');
    expect(updated.status).toBe('paused');

    // Should have created a HumanTask for the human step
    const tasks = await humanTaskRepo.getByInstanceId(instance.id);
    expect(tasks.length).toBe(1);
    expect(tasks[0].stepId).toBe('human-step');
    expect(tasks[0].status).toBe('claimed');
    expect(tasks[0].assignedUserId).toBe('user-1');
  });

  it('[DATA] advanceStep after agent completion to terminal step completes the instance', async () => {
    const directTerminalDef: WorkflowDefinition = {
      name: 'direct-terminal',
      version: 1,
      namespace: 'test',
      steps: [
        { id: 'agent-step', name: 'Agent Step', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'agent-step', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    await processRepo.saveWorkflowDefinition(directTerminalDef);
    const instance = await engine.createInstance('direct-terminal', 1, 'user-1', 'manual');
    await engine.startInstance(instance.id);

    const updated = await engine.advanceStep(
      instance.id,
      { result: 'done' },
      actor,
    );

    expect(updated.status).toBe('completed');
  });

  it('[DATA] advanceStep after agent completion to another agent step keeps running', async () => {
    const chainedAgentDef: WorkflowDefinition = {
      name: 'chained-agents',
      version: 1,
      namespace: 'test',
      steps: [
        { id: 'step-1', name: 'Step 1', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
        { id: 'step-2', name: 'Step 2', type: 'creation', executor: 'agent', autonomyLevel: 'L4' },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'step-1', to: 'step-2' },
        { from: 'step-2', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    await processRepo.saveWorkflowDefinition(chainedAgentDef);
    const instance = await engine.createInstance('chained-agents', 1, 'user-1', 'manual');
    await engine.startInstance(instance.id);

    const updated = await engine.advanceStep(
      instance.id,
      { result: 'step 1 output' },
      actor,
    );

    // Should advance to step-2 and remain running (next step is agent, not human)
    expect(updated.currentStepId).toBe('step-2');
    expect(updated.status).toBe('running');

    // No HumanTask should be created
    const tasks = await humanTaskRepo.getByInstanceId(instance.id);
    expect(tasks.length).toBe(0);
  });
});
