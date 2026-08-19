import { describe, expect, it } from 'vitest';
import { getCapabilities } from '../get-capabilities';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

/**
 * The handler derives availability so the browser never learns which env vars
 * are set. Agent availability reads the registry's own `requiredEnv` groups
 * against the live process env, so these tests set and restore the keys they
 * depend on.
 */

describe('getCapabilities handler', () => {
  it('reports email as available with the provider that resolved', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'smtp', configured: true, from: 'noreply@example.com' },
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.email.available).toBe(true);
    expect(capabilities.email.detail).toBe('smtp');
  });

  it('never leaks the configured from address, only the provider', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'mailgun', configured: true, from: 'noreply@example.com' },
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(JSON.stringify(capabilities)).not.toContain('noreply@example.com');
  });

  it('reports email as unavailable, and says who can fix it, when none is configured', async () => {
    const scope = createTestScope({ emailProviderInfo: null });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.email.available).toBe(false);
    expect(capabilities.email.reason).toMatch(/admin/i);
  });

  it('treats a plugin that resolved as configured but not usable as unavailable', async () => {
    const scope = createTestScope({
      emailProviderInfo: { provider: 'smtp', configured: false, from: null },
    });

    const { capabilities } = await getCapabilities({}, scope);

    expect(capabilities.email.available).toBe(false);
  });
});
