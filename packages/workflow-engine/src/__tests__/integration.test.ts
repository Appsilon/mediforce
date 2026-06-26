import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
} from '@mediforce/platform-core';
import type {
  WorkflowDefinition,
  CompleteHumanTaskPayload,
} from '@mediforce/platform-core';
import {
  WorkflowEngine,
  StepExecutor,
  InvalidTransitionError,
} from '../index';
import type { StepActor } from '../index';

/**
 * Integration tests for the workflow engine's full execution loop.
 *
 * Unlike the unit tests in this folder (which target a single transition or
 * engine method in isolation), these exercise the end-to-end lifecycle using
 * the in-memory repos from @mediforce/platform-core — no Firestore, no
 * emulators, no Docker. The engine never actually runs an agent or renders a
 * human UI; the test harness plays those roles by feeding step outputs into
 * advanceStep / completeHumanTask, exactly as the production auto-runner does.
 *
 * High-priority scenarios from issue #74:
 *   1. Start → agent → human → agent → complete (state at each transition)
 *   2. Agent step output populated into instance.variables and consumed by
 *      the next step's input
 *   3. Error recovery: agent crash → instance failure state → retry → complete
 *   4. Verdict-based routing: approve takes one path, revise takes another
 */

const actor: StepActor = { id: 'user-1', role: 'operator' };

// Mixed-executor loop: agent → human → agent → terminal.
const mixedLoopDef: WorkflowDefinition = {
  name: 'mixed-loop',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'draft', name: 'Draft', type: 'creation', executor: 'agent' },
    { id: 'review', name: 'Human Review', type: 'creation', executor: 'human' },
    { id: 'finalize', name: 'Finalize', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'finalize' },
    { from: 'finalize', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

// Variable propagation: the gather step's output must land in
// instance.variables and be readable by the downstream step's routing.
const propagationDef: WorkflowDefinition = {
  name: 'propagation-loop',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'gather', name: 'Gather', type: 'creation', executor: 'agent' },
    { id: 'enrich', name: 'Enrich', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    // High-score output flows to enrich; low score skips straight to done.
    { from: 'gather', to: 'enrich', when: 'output.score > 5' },
    { from: 'gather', to: 'done', when: 'else' },
    { from: 'enrich', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

// Crash + recovery loop.
const recoveryDef: WorkflowDefinition = {
  name: 'recovery-loop',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'process', name: 'Process', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'process' },
    { from: 'process', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

// Verdict-based routing: approve → approved, revise → back to draft.
const verdictRoutingDef: WorkflowDefinition = {
  name: 'verdict-routing',
  version: 1,
  namespace: 'test',
  visibility: 'private',
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
      },
    },
    { id: 'approved', name: 'Approved', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'approved' },
    { from: 'review', to: 'draft' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

describe('WorkflowEngine integration: full execution loop', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);

    await processRepo.saveWorkflowDefinition(mixedLoopDef);
    await processRepo.saveWorkflowDefinition(propagationDef);
    await processRepo.saveWorkflowDefinition(recoveryDef);
    await processRepo.saveWorkflowDefinition(verdictRoutingDef);
  });

  // Helper: create + start an instance of the named definition.
  async function startInstance(name: string): Promise<string> {
    const engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
    const instance = await engine.createInstance(
      'test', name, 1, 'user-1', 'manual', {},
    );
    await engine.startInstance(instance.id);
    return instance.id;
  }

  // --- Scenario 1: Start → agent → human → agent → complete ---

  it('drives the mixed-executor loop and asserts instance state at every transition', async () => {
    const engine = new WorkflowEngine(
      processRepo, instanceRepo, auditRepo,
      undefined, undefined, undefined,
      humanTaskRepo,
    );

    // created → running at 'draft'
    const instance = await engine.createInstance(
      'test', 'mixed-loop', 1, 'user-1', 'manual', {},
    );
    expect(instance.status).toBe('created');
    expect(instance.currentStepId).toBeNull();

    const started = await engine.startInstance(instance.id);
    expect(started.status).toBe('running');
    expect(started.currentStepId).toBe('draft');

    // draft (agent) → review (human): advancing onto a human step creates a
    // HumanTask and pauses the instance waiting for it.
    const afterDraft = await engine.advanceStep(
      instance.id, { summary: 'first draft' }, actor,
    );
    expect(afterDraft.status).toBe('paused');
    expect(afterDraft.pauseReason).toBe('waiting_for_human');
    expect(afterDraft.currentStepId).toBe('review');

    const tasks = await humanTaskRepo.getByInstanceId(instance.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].stepId).toBe('review');
    expect(tasks[0].status).toBe('claimed');

    // review (human) → finalize (agent): completing the human task resumes the
    // instance and advances past the review step.
    const completed = await engine.completeHumanTask(
      tasks[0].id,
      { kind: 'verdict', verdict: 'approve' } satisfies CompleteHumanTaskPayload,
      'user-1',
    );
    expect(completed.instance.status).toBe('running');
    expect(completed.instance.currentStepId).toBe('finalize');

    // finalize (agent) → done (terminal): the workflow completes.
    const finished = await engine.advanceStep(
      instance.id, { summary: 'finalized' }, actor,
    );
    expect(finished.status).toBe('completed');
    expect(finished.currentStepId).toBeNull();

    // Every step's output is retained on the instance variables.
    expect(finished.variables.draft).toMatchObject({ summary: 'first draft' });
    expect(finished.variables.finalize).toMatchObject({ summary: 'finalized' });
  });

  // --- Scenario 2: agent output → instance.variables → next step input ---

  it('propagates an agent step output into instance.variables and feeds it to the next step', async () => {
    const engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
    const instanceId = await startInstance('propagation-loop');

    // gather (agent) produces a scored output; score > 5 routes to enrich.
    const gatherOutput = { findings: 3, score: 7 };
    const afterGather = await engine.advanceStep(
      instanceId, gatherOutput, actor,
    );
    expect(afterGather.currentStepId).toBe('enrich');
    // The step output is recorded under its step id in instance.variables.
    expect(afterGather.variables.gather).toEqual(gatherOutput);

    // enrich (agent) → done (terminal): the workflow completes.
    const finished = await engine.advanceStep(
      instanceId, { enriched: true }, actor,
    );
    expect(finished.status).toBe('completed');
    expect(finished.currentStepId).toBeNull();

    // The downstream step's recorded input is the previous step's output —
    // i.e. the engine computed the semantic step input from instance.variables
    // when it dispatched enrich.
    const executions = await instanceRepo.getStepExecutions(instanceId);
    const enrichExecution = executions.find((e) => e.stepId === 'enrich');
    expect(enrichExecution).toBeDefined();
    expect(enrichExecution!.input).toEqual(gatherOutput);
  });

  it('skips the enrich step when the agent output does not meet the routing threshold', async () => {
    const engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
    const instanceId = await startInstance('propagation-loop');

    // Low score → the `else` transition fires, bypassing enrich.
    const finished = await engine.advanceStep(
      instanceId, { findings: 0, score: 2 }, actor,
    );
    expect(finished.status).toBe('completed');
    expect(finished.currentStepId).toBeNull();

    const executions = await instanceRepo.getStepExecutions(instanceId);
    expect(executions.some((e) => e.stepId === 'enrich')).toBe(false);
  });

  // --- Scenario 3: agent crash → failure state → retry → complete ---

  it('marks the instance failed when an agent step crashes, then recovers via retry', async () => {
    const engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
    // The engine delegates step execution to StepExecutor; the auto-runner
    // holds the same instance and calls failStep when the agent plugin errors.
    const stepExecutor = new StepExecutor(instanceRepo, auditRepo);
    const instanceId = await startInstance('recovery-loop');

    // start (agent) → process (agent).
    await engine.advanceStep(instanceId, { ok: true }, actor);
    let current = await instanceRepo.getById(instanceId);
    expect(current!.currentStepId).toBe('process');
    expect(current!.status).toBe('running');

    // Simulate the agent crashing on 'process'. failStep is the public entry
    // point the orchestrator uses — it parks the instance in a failure state
    // and records a failed step execution.
    const crash = new Error('agent plugin exited with non-zero status');
    await stepExecutor.failStep(current!, 'process', crash, actor);

    current = await instanceRepo.getById(instanceId);
    expect(current!.status).toBe('paused');
    expect(current!.pauseReason).toBe('step_failure');
    expect(current!.currentStepId).toBe('process');

    const executions = await instanceRepo.getStepExecutions(instanceId);
    const failedExec = executions
      .filter((e) => e.stepId === 'process')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
    expect(failedExec.status).toBe('failed');
    expect(failedExec.error).toBe(crash.message);

    // Recovery: retry flips the instance back to running so the auto-runner
    // can re-enter the failed step, which then completes the workflow.
    const retried = await engine.retryStep(instanceId, 'process', actor);
    expect(retried.status).toBe('running');
    expect(retried.error).toBeNull();
    expect(retried.currentStepId).toBe('process');

    const finished = await engine.advanceStep(
      instanceId, { result: 'ok' }, actor,
    );
    expect(finished.status).toBe('completed');
    expect(finished.currentStepId).toBeNull();
  });

  // --- Scenario 4: verdict-based routing ---

  it('routes approve to the approved terminal and revise back to the draft step', async () => {
    const engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);

    // --- approve path ---
    const approveInstanceId = await startInstance('verdict-routing');
    await engine.advanceStep(approveInstanceId, {}, actor); // draft → review
    const approved = await engine.submitReviewVerdict(
      approveInstanceId, 'review',
      {
        reviewerId: 'reviewer-1', reviewerRole: 'qa-lead',
        verdict: 'approve', comment: null,
        timestamp: new Date().toISOString(),
      },
      actor,
    );
    expect(approved.status).toBe('completed');
    const approveCompleted = auditRepo
      .getAll()
      .filter((e) => e.processInstanceId === approveInstanceId)
      .find((e) => e.action === 'instance.completed');
    expect(approveCompleted).toBeDefined();
    expect(
      (approveCompleted!.inputSnapshot as { terminalStepId?: string }).terminalStepId,
    ).toBe('approved');

    // --- revise path (separate instance from the same definition) ---
    const reviseInstanceId = await startInstance('verdict-routing');
    await engine.advanceStep(reviseInstanceId, {}, actor); // draft → review
    const revised = await engine.submitReviewVerdict(
      reviseInstanceId, 'review',
      {
        reviewerId: 'reviewer-1', reviewerRole: 'qa-lead',
        verdict: 'revise', comment: 'tighten the conclusion',
        timestamp: new Date().toISOString(),
      },
      actor,
    );
    // Revise loops back to draft — the instance is NOT complete and is on a
    // different step than the approve path.
    expect(revised.status).toBe('running');
    expect(revised.currentStepId).toBe('draft');
  });

  it('rejects advancing an instance that is not running', async () => {
    const engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
    const instanceId = await startInstance('recovery-loop');

    // Park it, then try to advance — advanceStep only works on a running instance.
    await engine.pauseInstance(instanceId, 'manual_hold', actor);
    await expect(
      engine.advanceStep(instanceId, {}, actor),
    ).rejects.toThrow(InvalidTransitionError);
  });
});
