import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showCaption, showResult, endRecording } from '../helpers/recording';

test.describe.serial('Cowork Session Journey', () => {
  test('browse cowork session — chat UI, messages, artifact panel', async ({ page }, testInfo) => {
    await setupRecording(page, 'cowork-chat-session', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/cowork/cowork-active-1`);

    // Page header loads with workflow name and step info
    await expect(page.getByRole('heading', { name: /Workflow Designer/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Step: design/)).toBeVisible();
    await showCaption(page, 'Cowork session — collaborative human+AI workspace');

    // Step description bubble visible (amber info bubble)
    await expect(page.getByText(/Collaboratively build a workflow definition/)).toBeVisible();
    await showCaption(page, 'Step description guides the collaboration', 2000);

    // Chat messages from seed data are rendered
    await expect(page.getByText(/I need a workflow for automated data quality review/)).toBeVisible();
    await expect(page.getByText(/I've drafted a 3-step workflow/)).toBeVisible();
    await showCaption(page, 'Conversation history — human and agent messages');

    // Artifact panel shows the draft artifact
    const artifactPanel = page.locator('[class*="w-\\[400px\\]"]');
    await expect(artifactPanel.getByRole('heading', { name: 'Artifact' })).toBeVisible();
    await expect(artifactPanel.getByText('Draft', { exact: true })).toBeVisible();
    await expect(artifactPanel.getByText('"data-quality-review"')).toBeVisible();
    await showCaption(page, 'Artifact panel — live preview of collaboratively built object', 2500);

    // Required fields checklist shows progress
    await expect(page.getByText('Required fields')).toBeVisible();
    await expect(page.getByText('3/3')).toBeVisible();
    await showCaption(page, 'All required fields fulfilled — ready to finalize');

    // Chat input is active
    const textarea = page.getByPlaceholder(/Type a message/);
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();

    // Finalize button is enabled (artifact present, all fields fulfilled)
    const finalizeButton = page.getByRole('button', { name: 'Finalize Artifact' });
    await expect(finalizeButton).toBeVisible();
    await expect(finalizeButton).toBeEnabled();
    await showResult(page);
  });

  test('finalize cowork session — artifact locked, success banner', async ({ page }, testInfo) => {
    await setupRecording(page, 'cowork-finalize-flow', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/cowork/cowork-active-1`);

    await expect(page.getByRole('heading', { name: /Workflow Designer/i })).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Active cowork session with complete artifact');

    // Click finalize
    const finalizeButton = page.getByRole('button', { name: 'Finalize Artifact' });
    await expect(finalizeButton).toBeEnabled({ timeout: 5_000 });
    await click(page, finalizeButton);
    await showCaption(page, 'Finalizing artifact and advancing workflow...');

    // Success banner appears
    await expect(page.getByText('Session finalized. Workflow has advanced to the next step.')).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Session finalized — workflow advances to next step', 2500);

    // Artifact shows "Finalized" badge instead of "Draft"
    await expect(page.getByText('Finalized', { exact: true })).toBeVisible();

    // Input is disabled after finalization
    const textarea = page.getByPlaceholder('Session finalized');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeDisabled();

    // "View run" link appears
    await expect(page.getByRole('link', { name: /View run/ })).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
