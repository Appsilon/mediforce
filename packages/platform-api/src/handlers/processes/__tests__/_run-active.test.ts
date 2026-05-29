import { describe, it, expect } from 'vitest';
import { buildProcessInstance } from '@mediforce/platform-core/testing';
import { isRunActiveForArchive } from '../_run-active';

describe('isRunActiveForArchive', () => {
  it('treats running and created runs as active', () => {
    expect(isRunActiveForArchive(buildProcessInstance({ id: 'a', status: 'running' }))).toBe(true);
    expect(isRunActiveForArchive(buildProcessInstance({ id: 'a', status: 'created' }))).toBe(true);
  });

  it('treats paused runs as active only when the pauseReason is one of the active reasons', () => {
    const active = buildProcessInstance({
      id: 'a',
      status: 'paused',
      pauseReason: 'waiting_for_human',
    });
    const inactive = buildProcessInstance({
      id: 'b',
      status: 'paused',
      pauseReason: 'awaiting_input',
    });
    expect(isRunActiveForArchive(active)).toBe(true);
    expect(isRunActiveForArchive(inactive)).toBe(false);
  });

  it('treats waiting_for_timer paused runs as active (maps to in_progress, will resume)', () => {
    const run = buildProcessInstance({
      id: 'a',
      status: 'paused',
      pauseReason: 'waiting_for_timer',
    });
    expect(isRunActiveForArchive(run)).toBe(true);
  });

  it('terminal statuses are not active', () => {
    expect(isRunActiveForArchive(buildProcessInstance({ id: 'a', status: 'completed' }))).toBe(false);
    expect(isRunActiveForArchive(buildProcessInstance({ id: 'a', status: 'failed' }))).toBe(false);
  });
});
