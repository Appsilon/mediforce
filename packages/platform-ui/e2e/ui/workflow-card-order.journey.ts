import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { getPageErrors, trackPageErrors } from '../helpers/page-errors';

test.describe('Workflow card order journey', () => {
  test('drag a workflow card to the front and it stays there after reload', async ({ page }) => {
    trackPageErrors(page);
    // The workflow-problems panel above the grid renders only once Docker
    // images and secret keys have loaded, and pushes every card down when it
    // appears. A drag started before then lands on the wrong spot.
    const problemsInputsLoaded = Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/system/docker-info')),
      page.waitForResponse((response) => response.url().includes('/api/workflow-secrets/keys-batch')),
    ]);
    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 10_000 });

    const workflowList = page.locator('[data-tour="workflow-list"]');
    const cards = workflowList.locator('[data-testid^="workflow-card-"]');
    await expect(cards.nth(1)).toBeVisible({ timeout: 15_000 });

    const cardNames = async () =>
      (await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))))
        .map((testId) => (testId ?? '').replace('workflow-card-', ''));

    // Both cards sit on screen together: a native HTML5 drag cannot scroll the
    // page under Playwright, so a far-away target is never reached.
    const [firstName, movedName] = await cardNames();

    await problemsInputsLoaded;
    const movedCard = page.getByTestId(`workflow-card-${movedName}`);
    let previousTop: number | undefined;
    await expect
      .poll(async () => {
        const top = (await movedCard.boundingBox())?.y;
        const settled = top !== undefined && top === previousTop;
        previousTop = top;
        return settled;
      })
      .toBe(true);

    // The grip only shows on hover, like a user would find it.
    await movedCard.hover();
    await page.getByTestId(`workflow-grip-${movedName}`).dragTo(page.getByTestId(`workflow-card-${firstName}`));

    await expect.poll(async () => (await cardNames())[0]).toBe(movedName);
    expect((await cardNames())[1]).toBe(firstName);

    await page.reload();
    await expect(cards.nth(1)).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await cardNames())[0]).toBe(movedName);
    expect((await cardNames())[1]).toBe(firstName);

    // Keyboard reorder: the grip takes focus and ArrowRight moves the card back one slot.
    await page.getByTestId(`workflow-grip-${movedName}`).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await cardNames())[0]).toBe(firstName);
    expect((await cardNames())[1]).toBe(movedName);
    await expect(page.getByTestId(`workflow-grip-${movedName}`)).toBeFocused();

    expect(getPageErrors(page)).toEqual([]);
  });
});
