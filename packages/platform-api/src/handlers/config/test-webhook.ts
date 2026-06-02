import type { PlatformSettingsRepository } from '@mediforce/platform-core';
import { sendTestWebhook } from '@mediforce/platform-infra';
import type { TestWebhookOutput } from '../../contract/config';

export interface TestWebhookDeps {
  platformSettingsRepo: PlatformSettingsRepository;
}

export async function testWebhook(deps: TestWebhookDeps): Promise<TestWebhookOutput> {
  return sendTestWebhook(deps.platformSettingsRepo);
}
