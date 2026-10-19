import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { trackPageErrors } from '../helpers/page-errors';
import { seedOutputFiles } from '../helpers/seed-output-files';
import { AUTH_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';

/**
 * UI journey: one viewer per step (ADR-0030 decision 7). The viewer opens on
 * `result.json`; a dropdown lists every Output File the step committed, each
 * rendered with its own viewer and each downloadable. The L3 review page
 * shows the same viewer to the reviewer.
 *
 * Output Files are seeded straight into the run's bare repo: under
 * MOCK_AGENT the mock plugin emits an envelope but commits nothing.
 */

const STEP_ID = 'grade-aes';
const SUMMARY_HEADING = 'Adverse Event Grading Summary';
const STEP_FILES = {
  'summary.md': `# ${SUMMARY_HEADING}\n\nTwo grade 3 events, no grade 5.\n`,
  'ae-listing.csv': 'subject,term,ctcaeGrade\nS-001,Neutropenia,3\n',
  'grades.json': '{"S-001": 3}\n',
};

const stepOutputFile = (page: Page) => page.getByRole('combobox', { name: 'Step output file' });

async function seedStepFiles(request: APIRequestContext, workflowName: string, runId: string): Promise<void> {
  await awaitFinishedAgentRun(request, runId);
  await seedOutputFiles(workflowName, runId, { [STEP_ID]: STEP_FILES });
}

test.describe('Step Output Viewer Journey', () => {
  test('reviewer switches between a step\'s result.json and its Output Files, and downloads one', async ({ page, request }) => {
    trackPageErrors(page);

    const workflowName = `e2e-step-output-viewer-${Date.now()}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L2' }));
    await seedStepFiles(request, workflowName, runId);

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(workflowName)}/runs/${runId}`);
    await page.getByRole('link', { name: /Grade adverse events/ }).first().click();

    // Opens on result.json, with the step's three files after it.
    const picker = stepOutputFile(page);
    await expect(picker).toHaveValue('result.json', { timeout: 15_000 });
    await expect(page.getByTestId('step-result-json')).toBeVisible();
    await expect(picker.getByRole('option')).toHaveText([
      'result.json',
      /^ae-listing\.csv/,
      /^grades\.json/,
      /^summary\.md/,
    ], { timeout: 15_000 });

    // Markdown renders as a document, CSV as a table, JSON formatted like result.json.
    await picker.selectOption(`.mediforce/output/${STEP_ID}/summary.md`);
    await expect(page.getByRole('heading', { name: SUMMARY_HEADING })).toBeVisible({ timeout: 10_000 });

    await picker.selectOption(`.mediforce/output/${STEP_ID}/ae-listing.csv`);
    await expect(page.getByRole('columnheader', { name: 'ctcaeGrade' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('cell', { name: 'Neutropenia' })).toBeVisible();

    await picker.selectOption(`.mediforce/output/${STEP_ID}/grades.json`);
    await expect(page.getByTestId('json-formatted').getByText('S-001')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Raw' }).click();
    await expect(page.getByTestId('json-raw')).toContainText('"S-001": 3');

    // Download the picked file.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /^download$/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('grades.json');

    // Back to the result.
    await picker.selectOption('result.json');
    await expect(page.getByTestId('step-result-json')).toBeVisible();
  });

  test('L3 reviewer sees the step output viewer on the review task', async ({ page, request }) => {
    trackPageErrors(page);

    const workflowName = `e2e-step-output-review-${Date.now()}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L3' }));
    await seedStepFiles(request, workflowName, runId);

    const reviewTask = await pollUntil(async () => {
      const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: AUTH_HEADERS });
      if (res.status() !== 200) return null;
      const body = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string }> };
      return body.tasks.find((task) => task.stepId === STEP_ID && task.status !== 'completed') ?? null;
    }, { description: `L3 review task for ${runId}` });

    await page.goto(`/${TEST_ORG_HANDLE}/tasks/${reviewTask.id}`);
    await expect(page.getByText('Agent Output for Review')).toBeVisible({ timeout: 20_000 });

    const picker = stepOutputFile(page);
    await expect(picker).toHaveValue('result.json');
    await expect(page.getByTestId('step-result-json')).toBeVisible();

    await picker.selectOption(`.mediforce/output/${STEP_ID}/summary.md`);
    await expect(page.getByRole('heading', { name: SUMMARY_HEADING })).toBeVisible({ timeout: 10_000 });

    // The reviewer can still decide.
    await expect(page.getByRole('button', { name: /^Approve$/ })).toBeVisible();
  });
});
