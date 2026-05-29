import { describe, it, expect } from 'vitest';
import { createQueryClient } from '../query-client';

describe('createQueryClient', () => {
  it('returns a QueryClient with ADR-0006 §3 defaults applied', () => {
    const qc = createQueryClient();
    const q = qc.getDefaultOptions().queries ?? {};
    const m = qc.getDefaultOptions().mutations ?? {};

    expect(q.refetchInterval).toBe(0);
    expect(q.refetchOnWindowFocus).toBe(false);
    expect(q.refetchOnReconnect).toBe(true);
    expect(q.staleTime).toBe(0);
    expect(q.gcTime).toBe(5 * 60 * 1000);
    expect(q.retry).toBe(2);
    expect(m.retry).toBe(0);
  });

  it('returns a fresh instance per call (test isolation)', () => {
    const a = createQueryClient();
    const b = createQueryClient();
    expect(a).not.toBe(b);
  });
});
