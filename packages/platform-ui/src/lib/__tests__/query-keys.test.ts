import { describe, it, expect } from 'vitest';
import { queryKeys } from '../query-keys';

describe('queryKeys', () => {
  it('tasks.all is the bare prefix', () => {
    expect(queryKeys.tasks.all()).toEqual(['tasks']);
  });

  it('tasks.byInstance puts the instanceId in a filter object on the tail', () => {
    expect(queryKeys.tasks.byInstance('inst-1')).toEqual(['tasks', { instanceId: 'inst-1' }]);
  });

  it('tasks.byInstance carries optional stepId + status filters', () => {
    expect(queryKeys.tasks.byInstance('inst-1', { stepId: 'step-x', status: ['pending'] })).toEqual([
      'tasks',
      { instanceId: 'inst-1', stepId: 'step-x', status: ['pending'] },
    ]);
  });

  it('tasks.byRole puts the role in a filter object on the tail', () => {
    expect(queryKeys.tasks.byRole('reviewer')).toEqual(['tasks', { role: 'reviewer' }]);
  });

  it('tasks.byRole carries optional status', () => {
    expect(queryKeys.tasks.byRole('reviewer', { status: ['completed'] })).toEqual([
      'tasks',
      { role: 'reviewer', status: ['completed'] },
    ]);
  });

  it('task (singular) keys the detail cache under a distinct prefix from the list', () => {
    expect(queryKeys.task('t-1')).toEqual(['task', 't-1']);
    expect(queryKeys.task('t-1')[0]).not.toBe(queryKeys.tasks.all()[0]);
  });
});
