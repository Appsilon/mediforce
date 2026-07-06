import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';
import { seedOutputFiles } from '../helpers/seed-output-files';

/**
 * UI journey: a reviewer opens the run's "Files" card and previews an Output
 * File in-browser (not just downloads it). Proves the "View" button →
 * OutputFilePreview modal → rendered content path end-to-end.
 *
 * The run is created via the API and its Output Files are seeded straight into
 * the bare repo (mock agent never commits under `.mediforce/output/`), then
 * the reviewer drives the browser. Self-contained: a fresh workflow + run per
 * run, so it mutates no shared seed data.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY };

const MARKDOWN_HEADING = 'TFL Summary Heading';
const MARKDOWN_CONTENT = `# ${MARKDOWN_HEADING}\n\nGenerated tables, figures, and listings.\n`;

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  { timeoutMs = 20_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const last = await fn();
    if (last !== null) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for condition (${timeoutMs}ms)`);
}

async function registerWorkflowDefinition(request: APIRequestContext, wdName: string): Promise<void> {
  const wd = {
    name: wdName,
    title: 'E2E Output File Preview',
    steps: [
      { id: 'generate', name: 'Generate artifacts', type: 'creation', executor: 'agent', autonomyLevel: 'L2' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'generate', to: 'done' }],
    triggers: [{ type: 'manual', name: 'Start' }],
  };
  const res = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
    data: wd,
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function startRunAndAwaitTerminal(request: APIRequestContext, wdName: string): Promise<string> {
  const triggerRes = await request.post('/api/processes', {
    headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
    data: { namespace: TEST_ORG_HANDLE, definitionName: wdName, triggeredBy: 'e2e-test', triggerName: 'Start' },
  });
  expect(triggerRes.status(), await triggerRes.text()).toBe(201);
  const { run } = (await triggerRes.json()) as { run: { id: string } };

  await pollUntil(async () => {
    const res = await request.get(`/api/runs/${run.id}`, { headers: AUTH_HEADERS });
    if (res.status() !== 200) return null;
    const body = (await res.json()) as { status: string };
    return body.status === 'completed' || body.status === 'failed' ? body : null;
  });
  return run.id;
}

test.describe('Output File Preview Journey', () => {
  test('reviewer previews a markdown Output File in a modal', async ({ page, request }) => {
    trackPageErrors(page);

    const wdName = `e2e-output-preview-${Date.now()}`;
    await registerWorkflowDefinition(request, wdName);
    const runId = await startRunAndAwaitTerminal(request, wdName);

    await seedOutputFiles(wdName, runId, {
      generate: {
        'summary.md': MARKDOWN_CONTENT,
        'table.csv': 'study,grade\nS-001,2\n',
      },
    });

    // Reviewer opens the run detail page — the "Files" card appears once the
    // run has Output Files.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(wdName)}/runs/${runId}`);
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible({ timeout: 15_000 });

    const filesCard = page
      .locator('.bg-card')
      .filter({ has: page.getByRole('heading', { name: 'Files', exact: true }) });
    const markdownRow = filesCard.locator('li').filter({ hasText: 'summary.md' });
    await expect(markdownRow).toBeVisible();

    // Click "View" → the preview modal opens and renders the markdown content
    // (heading rendered as real HTML, not raw `#` text).
    await markdownRow.getByRole('button', { name: /view/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'summary.md' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: MARKDOWN_HEADING })).toBeVisible({ timeout: 10_000 });

    // The modal keeps a Download button; closing returns to the run detail.
    await expect(dialog.getByRole('button', { name: /download/i })).toBeVisible();
    await dialog.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
