import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitActionHandler, isWaitSentinel, type WaitSentinel } from '../wait';
import type { ActionContext } from '../../types';

const baseCtx: ActionContext = {
  stepId: 'wait-step',
  processInstanceId: 'inst-1',
  sources: {
    triggerPayload: {},
    steps: {},
    variables: {},
    secrets: {},
  },
};

describe('waitActionHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('duration mode', () => {
    it('returns __wait sentinel with correct resumeAt for hours', async () => {
      const output = await waitActionHandler(
        { duration: { hours: 2 } },
        baseCtx,
      );

      expect(isWaitSentinel(output)).toBe(true);
      const sentinel = output as unknown as WaitSentinel;
      expect(sentinel.__wait.stepId).toBe('wait-step');
      expect(sentinel.__wait.resumeAt).toBe('2026-06-01T14:00:00.000Z');
      expect(sentinel.__wait.pausedAt).toBe('2026-06-01T12:00:00.000Z');
      expect(sentinel.__wait.mode).toBe('duration');
      expect(sentinel.__wait.condition).toBeUndefined();
    });

    it('computes resumeAt from mixed duration fields', async () => {
      const output = await waitActionHandler(
        { duration: { hours: 1, minutes: 30, seconds: 45 } },
        baseCtx,
      );

      const sentinel = output as unknown as WaitSentinel;
      const expected = new Date('2026-06-01T12:00:00.000Z');
      expected.setTime(expected.getTime() + ((1 * 60 + 30) * 60 + 45) * 1000);
      expect(sentinel.__wait.resumeAt).toBe(expected.toISOString());
    });

    it('includes condition in sentinel when provided', async () => {
      const output = await waitActionHandler(
        { duration: { minutes: 10 }, condition: 'variables.done == true' },
        baseCtx,
      );

      const sentinel = output as unknown as WaitSentinel;
      expect(sentinel.__wait.condition).toBe('variables.done == true');
    });
  });

  describe('deadline mode', () => {
    it('returns __wait sentinel for future deadline', async () => {
      const output = await waitActionHandler(
        { deadline: '2026-06-02T00:00:00.000Z' },
        baseCtx,
      );

      expect(isWaitSentinel(output)).toBe(true);
      const sentinel = output as unknown as WaitSentinel;
      expect(sentinel.__wait.resumeAt).toBe('2026-06-02T00:00:00.000Z');
      expect(sentinel.__wait.mode).toBe('deadline');
    });

    it('returns immediate result for past deadline', async () => {
      const output = await waitActionHandler(
        { deadline: '2026-05-31T00:00:00.000Z' },
        baseCtx,
      );

      expect(isWaitSentinel(output)).toBe(false);
      expect(output).toEqual({
        resumeReason: 'deadline_reached',
        waitedSeconds: 0,
        resolvedAt: '2026-06-01T12:00:00.000Z',
      });
    });

    it('returns immediate result for deadline equal to now', async () => {
      const output = await waitActionHandler(
        { deadline: '2026-06-01T12:00:00.000Z' },
        baseCtx,
      );

      expect(isWaitSentinel(output)).toBe(false);
      expect(output).toMatchObject({ resumeReason: 'deadline_reached', waitedSeconds: 0 });
    });

    it('throws on invalid deadline string', async () => {
      await expect(
        waitActionHandler({ deadline: 'not-a-date' }, baseCtx),
      ).rejects.toThrow("Invalid deadline: 'not-a-date'");
    });

    it('includes condition in sentinel for future deadline', async () => {
      const output = await waitActionHandler(
        { deadline: '2026-06-02T00:00:00.000Z', condition: 'variables.allDone == true' },
        baseCtx,
      );

      const sentinel = output as unknown as WaitSentinel;
      expect(sentinel.__wait.condition).toBe('variables.allDone == true');
    });
  });
});

describe('isWaitSentinel', () => {
  it('returns true for valid sentinel', () => {
    expect(isWaitSentinel({
      __wait: { stepId: 's1', resumeAt: '2026-06-01T00:00:00Z', pausedAt: '2026-06-01T00:00:00Z' },
    })).toBe(true);
  });

  it('returns false for regular output', () => {
    expect(isWaitSentinel({ resumeReason: 'deadline_reached', waitedSeconds: 0 })).toBe(false);
  });

  it('returns false for null __wait', () => {
    expect(isWaitSentinel({ __wait: null })).toBe(false);
  });

  it('returns false for __wait missing stepId', () => {
    expect(isWaitSentinel({ __wait: { resumeAt: '2026-06-01' } })).toBe(false);
  });

  it('returns false for __wait missing pausedAt', () => {
    expect(isWaitSentinel({ __wait: { stepId: 's1', resumeAt: '2026-06-01' } })).toBe(false);
  });
});
