import { test, expect } from '@playwright/test';

// Uses seeded data from auth-setup.ts:
// - processDefinitions: 'Supply Chain Review' (8 steps) and 'Data Quality Review' (3 steps)
// - processConfigs: 'Supply Chain Review:all-human:v1' with 7 stepConfigs
// - processInstances reference configName='all-human', configVersion='v1'

test.describe('Config Editor', () => {
  test('[RENDER] Configurations tab visible on process detail page', async ({
    page,
  }) => {
    await page.goto('/processes/Supply%20Chain%20Review');
    // The process detail page has Runs, Configurations, Definition tabs
    const configsTab = page.getByRole('tab', { name: /configurations/i });
    await expect(configsTab).toBeVisible({ timeout: 10_000 });

    // Click the Configurations tab
    await configsTab.click();

    // Config list content should render (either config cards or empty state)
    await expect(
      page.getByRole('link', { name: /new configuration/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('[DATA] Config list shows seeded configs', async ({ page }) => {
    await page.goto('/processes/Supply%20Chain%20Review');
    const configsTab = page.getByRole('tab', { name: /configurations/i });
    await configsTab.click();

    // The seeded config 'default' with version '1.0' should appear as a config card
    // ConfigList renders configName and configVersion inside card elements
    const configCard = page.locator('.bg-card').filter({ hasText: 'all-human' });
    await expect(configCard.first()).toBeVisible({ timeout: 10_000 });

    // Should show step count for the seeded config
    await expect(page.getByText('7 steps')).toBeVisible({ timeout: 10_000 });

    // Clone and View links should be present
    await expect(page.getByRole('link', { name: /clone/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /view/i }).first()).toBeVisible();
  });

  test('[RENDER] Config view page loads with accordion cards', async ({
    page,
  }) => {
    await page.goto('/configs/Supply%20Chain%20Review/all-human/1');

    // Page heading shows config name and version
    await expect(
      page.getByRole('heading', { name: /all-human/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('v1', { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Accordion cards should render with step names from the definition
    // Step names appear in both definition panel and accordion triggers, use first()
    await expect(
      page.getByText('Vendor Assessment').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText('Narrative Summary').first(),
    ).toBeVisible();

    // Fields should be disabled (read-only mode)
    const configNameInput = page.locator('#config-name');
    await expect(configNameInput).toBeDisabled();
    const configVersionInput = page.locator('#config-version');
    await expect(configVersionInput).toBeDisabled();

    // Edit (new version) button should be visible in read-only mode
    await expect(
      page.getByRole('link', { name: /edit.*new version/i }),
    ).toBeVisible();
  });

  test('[RENDER] New config page loads with human defaults', async ({
    page,
  }) => {
    await page.goto('/configs/new?process=Supply%20Chain%20Review');

    // Page heading shows "New Configuration"
    await expect(
      page.getByRole('heading', { name: /new configuration/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Accordion cards should render for each step in the definition
    // Step names appear in both definition panel and accordion triggers, use first()
    await expect(
      page.getByText('Vendor Assessment').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Narrative Summary').first()).toBeVisible();
    await expect(page.getByText('Human Review').first()).toBeVisible();

    // Save button should be present (editable mode)
    await expect(
      page.getByRole('button', { name: /save configuration/i }),
    ).toBeVisible();

    // Save button should be disabled (no config name/version entered yet)
    await expect(
      page.getByRole('button', { name: /save configuration/i }),
    ).toBeDisabled();
  });

  test('[CLICK] Clone link opens pre-populated editor', async ({ page }) => {
    // Navigate to process detail and click Configurations tab
    await page.goto('/processes/Supply%20Chain%20Review');
    const configsTab = page.getByRole('tab', { name: /configurations/i });
    await configsTab.click();

    // Wait for config list to load -- config card with 'default' should appear
    const configCard = page.locator('.bg-card').filter({ hasText: 'all-human' });
    await expect(configCard.first()).toBeVisible({ timeout: 10_000 });

    // Click the Clone link
    await page.getByRole('link', { name: /clone/i }).click();

    // Should navigate to new config page with clone params
    await expect(page).toHaveURL(/\/configs\/new\?.*cloneConfig=all-human/, {
      timeout: 10_000,
    });

    // Page heading should say "Clone Configuration"
    await expect(
      page.getByRole('heading', { name: /clone configuration/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Should show "Based on all-human v1"
    await expect(
      page.getByText(/based on all-human v1/i),
    ).toBeVisible({ timeout: 10_000 });

    // Config name input should have the source config name pre-filled
    const configNameInput = page.locator('#config-name');
    await expect(configNameInput).toHaveValue('all-human');

    // Version should be empty (user must provide a new version)
    const configVersionInput = page.locator('#config-version');
    await expect(configVersionInput).toHaveValue('');
  });
});
