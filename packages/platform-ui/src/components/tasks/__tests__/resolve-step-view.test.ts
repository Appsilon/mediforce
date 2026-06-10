import { describe, it, expect } from 'vitest';
import type { StepExecution } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { resolveStepView } from '../resolve-step-view';

function buildExecution(overrides: Partial<StepExecution> = {}): StepExecution {
  return {
    id: 'exec-1',
    instanceId: 'inst-0001',
    stepId: 'review',
    status: 'completed',
    input: {},
    output: { foo: 'bar' },
    verdict: null,
    executedBy: 'user-1',
    startedAt: '2026-06-01T10:00:00.000Z',
    completedAt: '2026-06-01T10:01:00.000Z',
    iterationNumber: 0,
    gateResult: null,
    error: null,
    ...overrides,
  };
}

const viewer = { uid: 'u-reviewer', role: 'reviewer' };

describe('resolveStepView', () => {
  it('returns not-executed when there are no tasks and no execution', () => {
    const view = resolveStepView({ tasks: [], execution: null, viewer });
    expect(view).toEqual({ kind: 'not-executed' });
  });

  it('returns execution-results when there is an execution but no task (agent/script step)', () => {
    const view = resolveStepView({
      tasks: [],
      execution: buildExecution(),
      viewer,
    });
    expect(view).toEqual({ kind: 'execution-results' });
  });

  it('returns an actionable human-step view for a pending task matching the viewer role', () => {
    const task = buildHumanTask({ status: 'pending', assignedRole: 'reviewer' });
    const view = resolveStepView({ tasks: [task], execution: null, viewer });
    expect(view).toEqual({
      kind: 'human-step',
      task,
      access: { kind: 'actionable' },
    });
  });

  it('returns an actionable view for a task claimed by the viewer', () => {
    const task = buildHumanTask({ status: 'claimed', assignedUserId: 'u-reviewer' });
    const view = resolveStepView({ tasks: [task], execution: null, viewer });
    expect(view).toEqual({
      kind: 'human-step',
      task,
      access: { kind: 'actionable' },
    });
  });

  it('locks a task claimed by another user', () => {
    const task = buildHumanTask({ status: 'claimed', assignedUserId: 'u-other' });
    const view = resolveStepView({ tasks: [task], execution: null, viewer });
    expect(view).toEqual({
      kind: 'human-step',
      task,
      access: { kind: 'claimed-by-other', claimedBy: 'u-other' },
    });
  });

  it('locks a pending task assigned to a different role', () => {
    const task = buildHumanTask({ status: 'pending', assignedRole: 'principal-investigator' });
    const view = resolveStepView({ tasks: [task], execution: null, viewer });
    expect(view).toEqual({
      kind: 'human-step',
      task,
      access: { kind: 'role-mismatch', requiredRole: 'principal-investigator' },
    });
  });

  it('treats a viewer without a role claim as allowed (admin browsing)', () => {
    const task = buildHumanTask({ status: 'pending', assignedRole: 'reviewer' });
    const view = resolveStepView({
      tasks: [task],
      execution: null,
      viewer: { uid: 'u-admin', role: null },
    });
    expect(view).toEqual({
      kind: 'human-step',
      task,
      access: { kind: 'actionable' },
    });
  });

  it('prefers the most recent actionable task when several exist', () => {
    const older = buildHumanTask({
      id: 'task-old',
      status: 'pending',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    const newer = buildHumanTask({
      id: 'task-new',
      status: 'pending',
      createdAt: '2026-06-02T10:00:00.000Z',
    });
    const view = resolveStepView({ tasks: [older, newer], execution: null, viewer });
    expect(view.kind).toBe('human-step');
    if (view.kind === 'human-step') expect(view.task.id).toBe('task-new');
  });

  it('returns a completed human-step view when the latest task is completed', () => {
    const task = buildHumanTask({
      status: 'completed',
      completedAt: '2026-06-01T11:00:00.000Z',
      completionData: { verdict: 'approve' },
    });
    const view = resolveStepView({ tasks: [task], execution: buildExecution(), viewer });
    expect(view).toEqual({
      kind: 'human-step',
      task,
      access: { kind: 'completed' },
    });
  });

  it('an actionable task wins over an older completed one (L3 revise loop)', () => {
    const completed = buildHumanTask({
      id: 'task-done',
      status: 'completed',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    const reopened = buildHumanTask({
      id: 'task-redo',
      status: 'pending',
      createdAt: '2026-06-02T10:00:00.000Z',
    });
    const view = resolveStepView({
      tasks: [completed, reopened],
      execution: buildExecution(),
      viewer,
    });
    expect(view.kind).toBe('human-step');
    if (view.kind === 'human-step') {
      expect(view.task.id).toBe('task-redo');
      expect(view.access).toEqual({ kind: 'actionable' });
    }
  });

  it('falls back to execution-results when the only task is cancelled', () => {
    const task = buildHumanTask({ status: 'cancelled' });
    const view = resolveStepView({ tasks: [task], execution: buildExecution(), viewer });
    expect(view).toEqual({ kind: 'execution-results' });
  });

  it('falls back to not-executed when the only task is cancelled and nothing ran', () => {
    const task = buildHumanTask({ status: 'cancelled' });
    const view = resolveStepView({ tasks: [task], execution: null, viewer });
    expect(view).toEqual({ kind: 'not-executed' });
  });
});
