import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/** "200K" / "1M" → tokens, so sort order can be asserted on the rendered column. */
function parseContext(label: string): number {
  const amount = Number(label.replace(/[KM]$/, ''));
  return label.endsWith('M') ? amount * 1_000_000 : amount * 1000;
}

// The registry holds more than the seeded models: the boot-time OpenRouter sync
// (`syncRegistryIfStale`) writes the live catalogue into the same database. Every
// assertion therefore targets an exact seeded cell, and none of them depend on
// the registry's size or on which other models happen to be present.
test.describe('Model Registry Journey', () => {
  test('user browses model registry, filters by provider and capabilities', async ({ page }) => {
    trackPageErrors(page);

    const modelCell = (name: string) => page.getByRole('cell', { name, exact: true });

    // ── Navigate to Models page via sidebar ──────────────────────────────
    await page.goto(`/${TEST_ORG_HANDLE}/agents/models`);
    await expect(page.getByRole('heading', { name: /model registry/i })).toBeVisible({ timeout: 30_000 });

    // ── Table renders seeded models, unfiltered by default ───────────────
    await expect(page.getByRole('table')).toBeVisible();
    const topPicks = page.getByRole('button', { name: /top picks/i });
    await expect(topPicks).toHaveAttribute('aria-pressed', 'false');
    await expect(modelCell('Claude Sonnet 4')).toBeVisible();
    await expect(modelCell('DeepSeek Chat')).toBeVisible();
    await expect(modelCell('GPT-4o')).toBeVisible();
    await expect(page.getByText(/showing 1.* of \d+ models/i)).toBeVisible();

    // ── Search filters by name ───────────────────────────────────────────
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('DeepSeek Chat');
    await expect(modelCell('DeepSeek Chat')).toBeVisible();
    await expect(modelCell('GPT-4o')).toBeHidden();

    // ── Clear search ─────────────────────────────────────────────────────
    await searchInput.clear();
    await expect(modelCell('GPT-4o')).toBeVisible();

    // ── Filter by provider ───────────────────────────────────────────────
    const providerFilter = page.getByRole('combobox', { name: /provider/i });
    await providerFilter.selectOption('anthropic');
    await expect(modelCell('Claude Sonnet 4')).toBeVisible();
    await expect(modelCell('DeepSeek Chat')).toBeHidden();
    await expect(modelCell('GPT-4o')).toBeHidden();

    // ── Reset provider filter ────────────────────────────────────────────
    await providerFilter.selectOption('');
    await expect(modelCell('DeepSeek Chat')).toBeVisible();

    // ── Filter by tools support ──────────────────────────────────────────
    const toolsFilter = page.getByRole('checkbox', { name: /tools/i });
    await toolsFilter.check();
    await expect(modelCell('Claude Sonnet 4')).toBeVisible();
    // DeepSeek Chat in seed has supportsTools: false
    await expect(modelCell('DeepSeek Chat')).toBeHidden();
    await toolsFilter.uncheck();

    // ── Filter by vision support ─────────────────────────────────────────
    const visionFilter = page.getByRole('checkbox', { name: /vision/i });
    await visionFilter.check();
    await expect(modelCell('Claude Sonnet 4')).toBeVisible();
    await expect(modelCell('GPT-4o')).toBeVisible();
    // DeepSeek doesn't support vision in seed
    await expect(modelCell('DeepSeek Chat')).toBeHidden();
    await visionFilter.uncheck();

    // ── Top picks is opt-in and keeps the ranked seeds ───────────────────
    await topPicks.click();
    await expect(topPicks).toHaveAttribute('aria-pressed', 'true');
    await expect(modelCell('Claude Sonnet 4')).toBeVisible();
    await topPicks.click();
    await expect(topPicks).toHaveAttribute('aria-pressed', 'false');

    // ── Sort by context length ───────────────────────────────────────────
    const contextHeader = page.getByRole('columnheader', { name: /context/i });
    await contextHeader.click(); // asc
    await contextHeader.click(); // desc — largest first
    const [, ...bodyRows] = await page.getByRole('row').all();
    const contexts = await Promise.all(
      bodyRows.map(async (row) => parseContext(await row.getByRole('cell').nth(2).innerText())),
    );
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts).toEqual([...contexts].sort((a, b) => b - a));
  });
});
