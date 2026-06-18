import { describe, expect, it } from 'vitest';
import { getEmailStatus } from '../email-status';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('getEmailStatus handler', () => {
  it('returns null provider when emailProviderInfo is not configured', async () => {
    const scope = createTestScope();
    const result = await getEmailStatus({}, scope);

    expect(result).toEqual({ provider: null, configured: false, from: null });
  });

  it('returns provider info when configured', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'smtp', configured: true, from: 'test@example.com' },
    });
    const result = await getEmailStatus({}, scope);

    expect(result).toEqual({ provider: 'smtp', configured: true, from: 'test@example.com' });
  });

  it('rejects non-admin callers', async () => {
    const scope = createTestScope({ caller: userCaller('u1', ['ns1']) });
    await expect(getEmailStatus({}, scope)).rejects.toThrow();
  });
});
