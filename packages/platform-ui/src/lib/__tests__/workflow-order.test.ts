import { describe, it, expect } from 'vitest';
import { applyWorkflowOrder, moveWorkflow, parseWorkflowOrder } from '../workflow-order';

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('applyWorkflowOrder', () => {
  it('sorts alphabetically when nothing is saved', () => {
    expect(applyWorkflowOrder(named('gamma', 'alpha', 'beta'), [])).toEqual(named('alpha', 'beta', 'gamma'));
  });

  it('follows the saved order', () => {
    expect(applyWorkflowOrder(named('alpha', 'beta', 'gamma'), ['gamma', 'alpha', 'beta'])).toEqual(
      named('gamma', 'alpha', 'beta'),
    );
  });

  it('appends workflows missing from the saved order alphabetically after the saved ones', () => {
    expect(applyWorkflowOrder(named('delta', 'alpha', 'charlie', 'beta'), ['charlie', 'alpha'])).toEqual(
      named('charlie', 'alpha', 'beta', 'delta'),
    );
  });

  it('ignores saved names that no longer exist', () => {
    expect(applyWorkflowOrder(named('alpha', 'beta'), ['deleted', 'beta', 'alpha'])).toEqual(named('beta', 'alpha'));
  });
});

describe('moveWorkflow', () => {
  it('moves a workflow forward onto the target position', () => {
    expect(moveWorkflow(['alpha', 'beta', 'gamma', 'delta'], 'alpha', 'gamma')).toEqual([
      'beta',
      'gamma',
      'alpha',
      'delta',
    ]);
  });

  it('moves a workflow backward onto the target position', () => {
    expect(moveWorkflow(['alpha', 'beta', 'gamma', 'delta'], 'delta', 'beta')).toEqual([
      'alpha',
      'delta',
      'beta',
      'gamma',
    ]);
  });

  it('returns the order unchanged when dropped on itself or an unknown name', () => {
    const order = ['alpha', 'beta'];
    expect(moveWorkflow(order, 'alpha', 'alpha')).toEqual(order);
    expect(moveWorkflow(order, 'alpha', 'missing')).toEqual(order);
  });
});

describe('parseWorkflowOrder', () => {
  it('reads a stored JSON array of names', () => {
    expect(parseWorkflowOrder('["beta","alpha"]')).toEqual(['beta', 'alpha']);
  });

  it('falls back to an empty order for missing or malformed values', () => {
    expect(parseWorkflowOrder(null)).toEqual([]);
    expect(parseWorkflowOrder('not json')).toEqual([]);
    expect(parseWorkflowOrder('{"alpha":1}')).toEqual([]);
    expect(parseWorkflowOrder('[1,2]')).toEqual([]);
  });
});
