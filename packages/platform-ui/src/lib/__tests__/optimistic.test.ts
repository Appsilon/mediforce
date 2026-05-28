import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { snapshotCache } from '../optimistic';

describe('snapshotCache', () => {
  it('restores every snapshotted key when restore() is called', () => {
    const qc = new QueryClient();
    qc.setQueryData(['task', 't1'], { id: 't1', status: 'pending' });
    qc.setQueryData(['tasks', { role: 'reviewer' }], [{ id: 't1' }, { id: 't2' }]);

    const { restore } = snapshotCache(qc, [
      ['task', 't1'],
      ['tasks', { role: 'reviewer' }],
    ]);

    // Mutate optimistically
    qc.setQueryData(['task', 't1'], { id: 't1', status: 'claimed' });
    qc.setQueryData(['tasks', { role: 'reviewer' }], [{ id: 't2' }]);

    restore();

    expect(qc.getQueryData(['task', 't1'])).toEqual({ id: 't1', status: 'pending' });
    expect(qc.getQueryData(['tasks', { role: 'reviewer' }])).toEqual([{ id: 't1' }, { id: 't2' }]);
  });

  it('restores undefined for a key that had no prior value', () => {
    const qc = new QueryClient();

    const { restore } = snapshotCache(qc, [['task', 't-new']]);

    qc.setQueryData(['task', 't-new'], { id: 't-new' });
    restore();

    expect(qc.getQueryData(['task', 't-new'])).toBeUndefined();
  });
});
