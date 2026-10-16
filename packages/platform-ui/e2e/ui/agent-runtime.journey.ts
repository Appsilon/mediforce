import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Agent runtime: a member opens an agent that names no runtime, picks one on
 * the definition page, saves, and finds it still chosen after a reload.
 */

test.describe('Agent Runtime Journey', () => {
  test('pick a runtime on an agent, save, and see it after reload', async ({ page }) => {
    trackPageErrors(page);
    const agentRes = await page.request.post('/api/agents', {
      data: {
        name: `E2E Runtime Agent ${Date.now()}`,
        iconName: 'Bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: '',
        inputDescription: '',
        outputDescription: '',
        namespace: TEST_ORG_HANDLE,
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const agentId = ((await agentRes.json()) as { agent: { id: string } }).agent.id;

    try {
      const definitionUrl = `/${TEST_ORG_HANDLE}/agents/definitions/${agentId}`;
      await page.goto(definitionUrl);
      const runtime = page.getByLabel('Runtime');
      await expect(runtime).toHaveValue('', { timeout: 30_000 });

      await runtime.selectOption('claude-code-agent');
      await page.getByRole('button', { name: /save changes/i }).click();
      await expect(page).toHaveURL(new RegExp(`/${TEST_ORG_HANDLE}/agents$`), { timeout: 15_000 });

      await page.goto(definitionUrl);
      await expect(page.getByLabel('Runtime')).toHaveValue('claude-code-agent', { timeout: 30_000 });
    } finally {
      await page.request.delete(`/api/agents/${agentId}`);
    }
  });
});
