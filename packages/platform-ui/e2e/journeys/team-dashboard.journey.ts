import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showCaption, showResult, endRecording } from '../helpers/recording';

test.describe('Team Dashboard Journey', () => {
  test('mission control shows agent team with live status and activity feed', async ({ page }, testInfo) => {
    await setupRecording(page, 'team-mission-control', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/team`);

    // Wait for Mission Control heading in activity feed
    await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible({ timeout: 15_000 });

    // Sidebar: "Your Team" header with agent list
    await expect(page.getByText('Your Team')).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Your agent team — live status at a glance', 2500);
    await showStep(page);

    // Agents should be visible in sidebar (API compiles on first hit — allow extra time)
    await expect(page.getByText('Risk Detection').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Claude Code Agent').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Driver Agent').first()).toBeVisible({ timeout: 5_000 });

    // Activity feed should show entries
    const feed = page.locator('main');
    await expect(feed.getByText(/completed|is working on|needs your input/i).first()).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Activity feed — all agent work in one timeline', 2500);
    await showStep(page);

    // Filter to "Needs attention"
    await click(page, page.getByRole('button', { name: 'Needs attention' }));
    await showStep(page);

    // Back to all
    await click(page, page.getByRole('button', { name: 'All' }));
    await showStep(page);

    await showResult(page);
  });

  test('selecting an agent shows detail panel with stats and runs', async ({ page }, testInfo) => {
    await setupRecording(page, 'team-agent-detail', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/team`);
    await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible({ timeout: 15_000 });

    // Wait for agents to load
    await expect(page.getByText('Risk Detection').first()).toBeVisible({ timeout: 10_000 });

    // Click on Risk Detection agent in the team sidebar (not the app shell nav sidebar)
    const teamSidebar = page.locator('aside', { has: page.getByText('Your Team') });
    const agentButton = teamSidebar.getByText('Risk Detection').first();
    await click(page, agentButton);
    await showCaption(page, 'Agent detail — stats, status, and run history', 2500);

    // Detail panel should show agent info
    const detailPanel = page.locator('aside').last();
    await expect(detailPanel.getByText('Risk Detection')).toBeVisible({ timeout: 5_000 });
    await expect(detailPanel.getByText('anthropic/claude-sonnet-4')).toBeVisible();

    // Stats should be visible
    await expect(detailPanel.getByText('Today')).toBeVisible();
    await expect(detailPanel.getByText('Success')).toBeVisible();
    await expect(detailPanel.getByText('Confidence')).toBeVisible();
    await showStep(page);

    // Recent runs section
    await expect(detailPanel.getByText('Recent runs')).toBeVisible();
    await showStep(page);

    // Navigate from detail panel to agent runs page
    await click(page, detailPanel.getByRole('link', { name: /view all runs/i }));
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Seamless navigation to full agent oversight', 2500);
    await showResult(page);
    await endRecording(page);
  });
});
