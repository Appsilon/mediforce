import { sendTestWebhook } from '@mediforce/platform-infra';
import type { CallerScope } from '../../repositories/index';
import type { TestWebhookOutput } from '../../contract/config';

/** @public-handler  Platform settings are deployment-global; webhook test is an admin operation. */
export async function testWebhook(_input: undefined, scope: CallerScope): Promise<TestWebhookOutput> {
  return sendTestWebhook(scope.system.platformSettings);
}
