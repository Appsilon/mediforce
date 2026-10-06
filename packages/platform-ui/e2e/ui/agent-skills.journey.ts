import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Agent skills (#1461, ADR-0025): a member opens an agent, ticks a Skill,
 * saves, and finds the Skill's chip on the agent card and the box still ticked
 * after a reload. The agent and the Skill are created for this test alone.
 */

test.describe('Agent Skills Journey', () => {
  test('tick a skill on an agent, save, and see it on the card and after reload', async ({ page }) => {
    test.setTimeout(60_000); // two round trips through the catalog and the editor
    trackPageErrors(page);
    const stamp = Date.now();
    const skillId = `e2e-ui-skill-${stamp}`;
    const agentName = `E2E Skill Agent ${stamp}`;

    const skillRes = await page.request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, {
      data: { files: [{ path: 'SKILL.md', contents: `---\nname: ${skillId}\ndescription: Derive the ADaM ADSL dataset\n---\n` }] },
    });
    expect(skillRes.status(), await skillRes.text()).toBe(201);
    const agentRes = await page.request.post('/api/agents', {
      data: {
        name: agentName,
        iconName: 'Bot',
        description: 'Holds a skill',
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
      await page.goto(`/${TEST_ORG_HANDLE}/agents`);
      const card = page.getByTestId('agent-card').filter({ hasText: agentName });
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole('link', { name: 'Configure' }).click();

      await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
      const checkbox = page.getByRole('checkbox', { name: `Skill ${TEST_ORG_HANDLE}/${skillId}` });
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
      await page.getByRole('button', { name: /save changes/i }).click();

      // Save lands back on the catalog, where the card now carries the chip.
      await expect(page).toHaveURL(new RegExp(`/${TEST_ORG_HANDLE}/agents$`), { timeout: 15_000 });
      await expect(card.getByTitle(`${TEST_ORG_HANDLE}/${skillId}`)).toHaveText(skillId, { timeout: 15_000 });

      await card.getByRole('link', { name: 'Configure' }).click();
      await expect(page).toHaveURL(new RegExp(`/agents/definitions/${agentId}$`), { timeout: 15_000 });
      await page.reload();
      await expect(page.getByRole('checkbox', { name: `Skill ${TEST_ORG_HANDLE}/${skillId}` })).toBeChecked({ timeout: 30_000 });
    } finally {
      await page.request.delete(`/api/agents/${agentId}`);
      await page.request.delete(`/api/skills/${skillId}?namespace=${TEST_ORG_HANDLE}`);
    }
  });
});
