import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Model Registry Journey', () => {
  test('user browses model registry, filters by provider and capabilities', async ({ page }, testInfo) => {
    await setupRecording(page, 'model-registry', testInfo);

    // ── Navigate to Models page via sidebar ──────────────────────────────
    await page.goto(`/${TEST_ORG_HANDLE}/agents/models`);
    await expect(page.getByRole('heading', { name: /model registry/i })).toBeVisible({ timeout: 30_000 });
    await showStep(page);

    // ── Table renders seeded models ──────────────────────────────────────
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('Claude Sonnet 4')).toBeVisible();
    await expect(page.getByText('DeepSeek Chat')).toBeVisible();
    await expect(page.getByText('GPT-4o')).toBeVisible();
    await showStep(page);

    // ── Search filters by name ───────────────────────────────────────────
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('Claude');
    await expect(page.getByText('Claude Sonnet 4')).toBeVisible();
    await expect(page.getByText('DeepSeek Chat')).not.toBeVisible();
    await showStep(page);

    // ── Clear search ─────────────────────────────────────────────────────
    await searchInput.clear();
    await expect(page.getByText('DeepSeek Chat')).toBeVisible();

    // ── Filter by provider ───────────────────────────────────────────────
    const providerFilter = page.getByRole('combobox', { name: /provider/i });
    await providerFilter.selectOption('anthropic');
    await expect(page.getByText('Claude Sonnet 4')).toBeVisible();
    await expect(page.getByText('DeepSeek Chat')).not.toBeVisible();
    await expect(page.getByText('GPT-4o')).not.toBeVisible();
    await showStep(page);

    // ── Reset provider filter ────────────────────────────────────────────
    await providerFilter.selectOption('');
    await expect(page.getByText('DeepSeek Chat')).toBeVisible();

    // ── Filter by tools support ──────────────────────────────────────────
    const toolsFilter = page.getByRole('checkbox', { name: /tools/i });
    await toolsFilter.check();
    await expect(page.getByText('Claude Sonnet 4')).toBeVisible();
    // DeepSeek Chat in seed has supportsTools: false
    await expect(page.getByText('DeepSeek Chat')).not.toBeVisible();
    await toolsFilter.uncheck();
    await showStep(page);

    // ── Filter by vision support ─────────────────────────────────────────
    const visionFilter = page.getByRole('checkbox', { name: /vision/i });
    await visionFilter.check();
    await expect(page.getByText('Claude Sonnet 4')).toBeVisible();
    await expect(page.getByText('GPT-4o')).toBeVisible();
    // DeepSeek doesn't support vision in seed
    await expect(page.getByText('DeepSeek Chat')).not.toBeVisible();
    await visionFilter.uncheck();

    // ── Sort by context length ───────────────────────────────────────────
    const contextHeader = page.getByRole('columnheader', { name: /context/i });
    await contextHeader.click(); // asc
    await contextHeader.click(); // desc — largest first
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toContainText('200K');
    await showStep(page);

    // ── Verify model count display ───────────────────────────────────────
    await expect(page.getByText(/showing.*3.*models/i)).toBeVisible();

    await showResult(page);
    await endRecording(page);
  });
});
