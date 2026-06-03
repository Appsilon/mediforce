import { describe, it, expect, vi } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import { testWebhook } from '../index';

vi.mock('@mediforce/platform-infra', () => ({
  sendTestWebhook: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('testWebhook', () => {
  it('calls sendTestWebhook and returns the result', async () => {
    const { sendTestWebhook: sendTestWebhookMock } = await import('@mediforce/platform-infra');
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const scope = createTestScope({ platformSettingsRepo });
    const result = await testWebhook(undefined, scope);
    expect(sendTestWebhookMock).toHaveBeenCalledWith(platformSettingsRepo);
    expect(result).toEqual({ ok: true });
  });
});
